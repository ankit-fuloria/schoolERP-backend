const crypto = require('node:crypto');
const platform = require('../tenancy/platform');
const { fail } = require('../tenancy/access');
const months = { monthly: 1, quarterly: 3, annually: 12 };
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
function date(value, name = 'Date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      isNaN(new Date(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(400, `${name} must be a valid YYYY-MM-DD date`);
  return value;
}
const dueAt = value => new Date(`${date(value, 'Due date')}T23:59:59.999+05:30`);
function money(value, name, min = 0) {
  if (!Number.isSafeInteger(value) || value < min || value > 100000000000) fail(400, `${name} must be a valid amount in paise`);
  return value;
}
function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${name} is required (maximum ${max} characters)`);
  return value.trim();
}
function tax(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 || Math.abs(Math.round(value * 100) - value * 100) > 0.000001) fail(400, 'Tax percentage must be between 0 and 100 with up to two decimals');
  return value;
}
async function settings() {
  return await platform.get().PaymentSettings.findOne({ key: 'default' }).lean() ||
    { erpBaseMinor: 0, maintenanceMinMinor: 0, maintenanceMaxMinor: 0, freeMonths: 0, taxPercent: 0 };
}
async function saveSettings(input, ownerId) {
  const value = {
    erpBaseMinor: money(input.erpBaseMinor, 'ERP base cost', 1),
    maintenanceMinMinor: money(input.maintenanceMinMinor, 'Minimum maintenance'),
    maintenanceMaxMinor: money(input.maintenanceMaxMinor, 'Maximum maintenance'),
    freeMonths: input.freeMonths, taxPercent: tax(input.taxPercent ?? 0), updatedBy: ownerId,
  };
  if (!Number.isInteger(value.freeMonths) || value.freeMonths < 0 || value.freeMonths > 120) fail(400, 'Free maintenance months must be between 0 and 120');
  if (value.maintenanceMaxMinor < value.maintenanceMinMinor) fail(400, 'Maximum maintenance cannot be less than the minimum');
  return platform.get().PaymentSettings.findOneAndUpdate({ key: 'default' }, { $set: value }, { upsert: true, new: true, runValidators: true });
}
function shift(value, count) {
  const d = new Date(`${value}T00:00:00Z`);
  const original = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + count);
  d.setUTCDate(Math.min(original, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
async function pricing(input) {
  const config = await settings();
  if (!config.erpBaseMinor) fail(400, 'Configure owner payment settings first');
  const discountMinor = money(input.discountMinor ?? 0, 'Discount');
  if (discountMinor > config.erpBaseMinor) fail(400, 'Discount cannot exceed the ERP base cost');
  const monthlyMaintenanceMinor = money(input.monthlyMaintenanceMinor, 'Monthly maintenance');
  if (monthlyMaintenanceMinor < config.maintenanceMinMinor || monthlyMaintenanceMinor > config.maintenanceMaxMinor) fail(400, 'Monthly maintenance must be within the configured range');
  if (!Object.hasOwn(months, input.cycle)) fail(400, 'Choose monthly, quarterly or yearly maintenance');
  const activationDate = date(input.activationDate, 'Activation date');
  const expiry = shift(activationDate, config.freeMonths);
  const firstMaintenanceDate = expiry.slice(8) === '01' ? expiry : shift(`${expiry.slice(0, 7)}-01`, 1);
  return { erpBaseMinor: config.erpBaseMinor, discountMinor, erpNetMinor: config.erpBaseMinor - discountMinor,
    monthlyMaintenanceMinor, freeMonths: config.freeMonths, cycle: input.cycle, activationDate, firstMaintenanceDate };
}
function view(value, now = new Date()) {
  const inv = value.toObject ? value.toObject() : value;
  const paidMinor = inv.status === 'paid' ? inv.amountMinor : inv.paidMinor || 0;
  const outstandingMinor = inv.status === 'void' ? 0 : Math.max(0, inv.amountMinor - paidMinor);
  let remainingPaid = paidMinor;
  const installments = (inv.installments?.length ? inv.installments : [{ label: 'Full payment', amountMinor: inv.amountMinor, dueDate: inv.dueDate, dueAt: inv.dueAt }]).map(item => {
    const paid = Math.min(remainingPaid, item.amountMinor); remainingPaid -= paid;
    const pending = inv.status === 'void' ? 0 : item.amountMinor - paid;
    return { ...item, paidMinor: paid, outstandingMinor: pending, overdue: pending > 0 && new Date(item.dueAt) < now };
  });
  const next = installments.find(item => item.outstandingMinor > 0);
  return { ...inv, paidMinor, outstandingMinor, installments,
    overdueMinor: installments.filter(item => item.overdue).reduce((n, item) => n + item.outstandingMinor, 0),
    overdue: installments.some(item => item.overdue), nextDueDate: next?.dueDate || null,
    nextDueAt: next?.dueAt || null, nextDueMinor: next?.outstandingMinor || 0 };
}
function summary(invoices) {
  const items = invoices.map(inv => view(inv));
  return { totalPaidMinor: items.reduce((n, i) => n + i.paidMinor, 0),
    outstandingMinor: items.reduce((n, i) => n + i.outstandingMinor, 0),
    overdueMinor: items.reduce((n, i) => n + i.overdueMinor, 0),
    erpPendingMinor: items.filter(i => i.kind === 'erp').reduce((n, i) => n + i.outstandingMinor, 0),
    maintenancePendingMinor: items.filter(i => i.kind === 'maintenance' || i.kind === 'legacy' || !i.kind).reduce((n, i) => n + i.outstandingMinor, 0) };
}
async function schoolStatus(school, branch) {
  if (!school || !branch || String(branch.schoolId) !== String(school._id)) return 'disabled';
  if (!school.active || !branch.active) return 'disabled';
  const invoices = await platform.get().Invoice.find({ schoolId: school._id, status: { $in: ['unpaid', 'partial'] } });
  return invoices.some(inv => view(inv).overdue) ? 'overdue' : 'active';
}
async function reminders(now = today()) {
  const { School, Invoice } = platform.get();
  const schools = await School.find({ active: true, 'pricing.firstMaintenanceDate': { $lte: now } }).lean();
  const results = [];
  for (const school of schools) {
    if (school.pricing.monthlyMaintenanceMinor === 0) continue;
    const raised = new Set((await Invoice.find({ schoolId: school._id, kind: 'maintenance' }).select('periodStart').lean()).map(i => i.periodStart));
    let period = school.pricing.firstMaintenanceDate;
    for (let i = 0; period <= now && i < 1200; i++, period = shift(period, months[school.pricing.cycle])) {
      if (!raised.has(period)) results.push({ schoolId: school._id, schoolName: school.name, periodStart: period,
        periodEnd: new Date(new Date(`${shift(period, months[school.pricing.cycle])}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10),
        cycle: school.pricing.cycle, amountMinor: school.pricing.monthlyMaintenanceMinor * months[school.pricing.cycle] });
    }
  }
  return results;
}
async function issue(schoolId, input, ownerId) {
  const { School, Invoice } = platform.get();
  const session = await platform.connection().startSession();
  let invoice;
  try { await session.withTransaction(async () => {
    const school = await School.findById(schoolId).session(session);
    if (!school) fail(404, 'School not found');
    const kind = input.kind;
    if (!['erp', 'maintenance'].includes(kind)) fail(400, 'Choose ERP setup or maintenance');
    if (!school.pricing?.cycle) fail(400, 'Configure this school payment plan before issuing invoices');
    const plan = school.pricing;
    // Conflicting invoice/plan transactions retry against the latest school state.
    await School.updateOne({ _id: school._id }, { $inc: { billingRevision: 1 } }, { session });
    let subtotalMinor, discountMinor = 0, periodStart, periodEnd;
    if (kind === 'erp') {
      // Serialise invoice issuance per school to prevent duplicate one-time ERP charges.
      if (await Invoice.exists({ schoolId, kind: 'erp', status: { $ne: 'void' } }).session(session)) fail(409, 'An ERP setup invoice already exists');
      subtotalMinor = plan.erpBaseMinor; discountMinor = plan.discountMinor;
    } else {
      periodStart = date(input.periodStart, 'Maintenance period start');
      const monthDiff = (Number(periodStart.slice(0, 4)) - Number(plan.firstMaintenanceDate.slice(0, 4))) * 12 + Number(periodStart.slice(5, 7)) - Number(plan.firstMaintenanceDate.slice(5, 7));
      if (periodStart.slice(8) !== '01' || periodStart < plan.firstMaintenanceDate || monthDiff % months[plan.cycle] !== 0 || periodStart > today()) fail(400, 'Choose a maintenance period that is due for billing');
      if (await Invoice.exists({ schoolId, billingDate: periodStart }).session(session)) fail(409, 'This maintenance period has already been invoiced');
      periodEnd = new Date(new Date(`${shift(periodStart, months[plan.cycle])}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
      subtotalMinor = plan.monthlyMaintenanceMinor * months[plan.cycle];
    }
    const taxPercent = tax(input.taxPercent ?? 0);
    const taxMinor = Math.round((subtotalMinor - discountMinor) * Math.round(taxPercent * 100) / 10000);
    const amountMinor = money(subtotalMinor - discountMinor + taxMinor, 'Invoice total', kind === 'erp' ? 0 : 1);
    const dueDate = date(input.dueDate, 'Due date');
    if (dueDate < today()) fail(400, 'New invoice due date cannot be in the past');
    let installments = [{ label: 'Full payment', amountMinor, dueDate, dueAt: dueAt(dueDate) }];
    if (kind === 'erp' && input.paymentMode === 'split') {
      const advance = money(input.advanceMinor, 'Advance', 1);
      const balanceDueDate = date(input.balanceDueDate, 'Balance due date');
      if (advance >= amountMinor || balanceDueDate < dueDate) fail(400, 'Advance must be less than total and balance cannot be due before advance');
      installments = [{ label: 'Advance', amountMinor: advance, dueDate, dueAt: dueAt(dueDate) },
        { label: 'Balance', amountMinor: amountMinor - advance, dueDate: balanceDueDate, dueAt: dueAt(balanceDueDate) }];
    } else if (input.paymentMode && input.paymentMode !== 'full') fail(400, 'Choose full payment or advance and balance');
    [invoice] = await Invoice.create([{ schoolId, number: `BILL-${crypto.randomUUID()}`, kind, documentType: 'bill',
      description: input.description ? text(input.description, 'Description', 1000) : kind === 'erp' ? 'ERP setup' : `${plan.cycle} maintenance (${periodStart} to ${periodEnd})`,
      subtotalMinor, discountMinor, taxPercent, taxMinor, amountMinor, installments, dueDate, dueAt: dueAt(dueDate),
      ...(amountMinor === 0 ? { status: 'paid', paidAt: new Date() } : {}),
      issuedAt: new Date(), periodStart, periodEnd, ...(kind === 'maintenance' ? { billingDate: periodStart, cycle: plan.cycle, maintenanceAmountMinor: subtotalMinor } : {}),
      createdBy: ownerId, updatedBy: ownerId }], { session });
    await require('../tenancy/billing').invoiceNotice(school, invoice, session);
    await require('./ownerFinance').complete(invoice, school, ownerId, session);
  }); } finally { await session.endSession(); }
  return view(invoice);
}
async function recordPayment(schoolId, invoiceId, input, ownerId) {
  const { Invoice, Payment, School } = platform.get();
  const session = await platform.connection().startSession();
  let result;
  const amountMinor = money(input.amountMinor, 'Payment', 1);
  const paymentDate = date(input.paymentDate, 'Payment date');
  if (paymentDate > today()) fail(400, 'Payment date cannot be in the future');
  const reference = text(input.reference, 'Payment reference');
  const requestId = text(input.requestId, 'Payment request ID', 100);
  const method = text(input.method, 'Payment method', 40);
  if (!['bank_transfer', 'upi', 'cash', 'cheque', 'other'].includes(method)) fail(400, 'Invalid payment method');
  const notes = input.notes ? text(input.notes, 'Notes', 1000) : '';
  try { await session.withTransaction(async () => {
    const invoice = await Invoice.findOne({ _id: invoiceId, schoolId }).session(session);
    if (!invoice) fail(404, 'Invoice not found');
    const prior = await Payment.findOne({ invoiceId, requestId }).session(session);
    if (prior) {
      if (prior.amountMinor !== amountMinor || prior.reference !== reference || prior.method !== method || prior.paymentDate !== paymentDate || prior.notes !== notes) fail(409, 'This payment request ID was already used for a different payment');
      result = view(invoice); return;
    }
    const current = view(invoice);
    if (invoice.status === 'void' || current.outstandingMinor < amountMinor) fail(409, 'Payment exceeds the outstanding balance or invoice is cancelled');
    if (invoice.issuedAt && paymentDate < todayFrom(invoice.issuedAt)) fail(400, 'Payment date cannot precede invoice issuance');
    await Payment.create([{ schoolId, invoiceId, amountMinor, paymentDate, method, reference, notes, requestId, createdBy: ownerId }], { session });
    invoice.paidMinor = current.paidMinor + amountMinor;
    invoice.status = invoice.paidMinor === invoice.amountMinor ? 'paid' : 'partial';
    invoice.paymentReference = reference; invoice.updatedBy = ownerId;
    if (invoice.status === 'paid') invoice.paidAt = new Date();
    await invoice.save({ session });
    result = view(invoice);
    const school = await School.findById(schoolId).session(session);
    await require('../tenancy/billing').notify(school, `payment:${invoice._id}:${requestId}`, `${school.name}: payment recorded`,
      `Bill: ${invoice.number}\nType: ${invoice.kind}\nPayment: INR ${(amountMinor / 100).toFixed(2)}\nPaid total: INR ${(invoice.paidMinor / 100).toFixed(2)}\nPending: INR ${(result.outstandingMinor / 100).toFixed(2)}\nReference: ${reference}`, session);
    await require('./ownerFinance').complete(invoice, school, ownerId, session, paymentDate);
  }); } finally { await session.endSession(); }
  return result;
}
const todayFrom = value => new Date(new Date(value).getTime() + 330 * 60000).toISOString().slice(0, 10);
async function ledger(schoolId) {
  const { Invoice, Payment } = platform.get();
  const invoices = (await Invoice.find({ schoolId }).sort({ createdAt: -1 })).map(i => view(i));
  const payments = await Payment.find({ schoolId }).sort({ paymentDate: -1, createdAt: -1 }).lean();
  const completedInvoices = await platform.get().CompletedInvoice.find({ schoolId }).sort({ issuedAt: -1 }).lean();
  return { invoices, bills: invoices, completedInvoices, payments, summary: summary(invoices) };
}
module.exports = { settings, saveSettings, pricing, view, summary, schoolStatus, reminders, issue, recordPayment, ledger, dueAt, today, shift };
