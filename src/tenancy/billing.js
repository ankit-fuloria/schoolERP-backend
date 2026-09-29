const platform = require('./platform');
const { fail } = require('./access');
const mailer = require('../services/mailer');
const months = { monthly: 1, quarterly: 3, annually: 12 };
const istDate = date => new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10);
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !isNaN(date) && date.toISOString().slice(0, 10) === value;
}
function subscription(value, ownerId) {
  if (!value || !Object.hasOwn(months, value.cycle)) fail(400, 'Choose monthly, quarterly or annually');
  for (const key of ['cycleAmountMinor', 'monthlyMaintenanceMinor']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1000000000) fail(400, 'Billing amounts must be non-negative whole paise');
  }
  if (value.cycleAmountMinor + value.monthlyMaintenanceMinor * months[value.cycle] < 1) fail(400, 'Total subscription charge must be positive');
  if (!validDate(value.firstBillingDate)) fail(400, 'First billing date must be YYYY-MM-DD');
  if (value.firstBillingDate < istDate(new Date())) fail(400, 'First billing date cannot be in the past');
  return { cycle: value.cycle, cycleAmountMinor: value.cycleAmountMinor,
    monthlyMaintenanceMinor: value.monthlyMaintenanceMinor, firstBillingDate: value.firstBillingDate,
    nextBillingDate: value.firstBillingDate, createdBy: ownerId };
}
// Keep the original billing day when a shorter month clamps a renewal date.
function nextDate(current, cycle, anchor) {
  const date = new Date(`${current}T00:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months[cycle]);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(Number(anchor.slice(8)), last));
  return date.toISOString().slice(0, 10);
}
async function notify(school, key, subject, text, session) {
  const { Owner, Principal, Mail } = platform.get();
  const owners = await Owner.find({ active: true }).session(session || null).select('email');
  const admins = await Principal.find({ schoolId: school._id, active: true }).session(session || null).select('email');
  for (const to of new Set([...owners, ...admins].map(x => x.email))) {
    await Mail.updateOne({ key: `${key}:${to}` }, { $setOnInsert: { to, subject, text } }, { upsert: true, session });
  }
}
async function invoiceNotice(school, invoice, session) {
  const details = require('../services/ownerBilling').view(invoice);
  await notify(school, `invoice:${invoice._id}:${invoice.status}`, `${school.name}: bill ${invoice.number} ${invoice.status}`,
    `School: ${school.name} (${school.code})\nBill: ${invoice.number}\nType: ${invoice.kind || 'legacy'}\n${invoice.description}\nAmount: INR ${(invoice.amountMinor / 100).toFixed(2)}\nTax: ${invoice.taxPercent || 0}% (INR ${((invoice.taxMinor || 0) / 100).toFixed(2)})\nPaid: INR ${(details.paidMinor / 100).toFixed(2)}\nPending: INR ${(details.outstandingMinor / 100).toFixed(2)}\n${details.installments.map(i => `${i.label}: INR ${(i.amountMinor / 100).toFixed(2)} due ${i.dueDate} (IST)`).join('\n')}\nStatus: ${invoice.status}\n${invoice.status === 'paid' ? 'Payment has been recorded for this bill. Any other unpaid overdue bills must also be settled to restore ERP access.' : invoice.status === 'void' ? 'This bill has been cancelled. No payment is required for this bill.' : 'Please arrange payment by each scheduled due date. Unpaid overdue installments suspend ERP access for all branches.'}`, session);
}
async function generate(now = new Date()) {
  // Invoices are issued by the owner; the worker only sends overdue notices.
  const { School, Invoice } = platform.get();
  const overdue = await Invoice.find({ status: { $in: ['unpaid', 'partial'] } });
  for (const invoice of overdue) {
    const details = require('../services/ownerBilling').view(invoice, now);
    if (!details.overdue) continue;
    const school = await School.findById(invoice.schoolId);
    if (school) await notify(school, `overdue:${invoice._id}:${details.nextDueDate}`, `${school.name}: subscription overdue`,
      `Bill: ${invoice.number}\nOverdue amount: INR ${(details.overdueMinor / 100).toFixed(2)}\nPending total: INR ${(details.outstandingMinor / 100).toFixed(2)}\nERP access is suspended until overdue payments are recorded.`);
  }
}
async function deliver(send) {
  if (!send) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return;
    send = mailer.send;
  }
  const { Mail } = platform.get();
  for (let i = 0; i < 50; i++) {
    const now = new Date();
    const mail = await Mail.findOneAndUpdate({ sentAt: null, nextAttemptAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
    { $set: { leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
    if (!mail) break;
    try {
      await send(mailer.message(mail));
      await Mail.updateOne({ _id: mail._id }, { $set: { sentAt: new Date(), lastError: null, leaseUntil: null } });
    } catch (_) {
      // Never persist SMTP errors, which may contain account or authentication data.
      await Mail.updateOne({ _id: mail._id }, { $set: { lastError: 'Delivery failed; retry scheduled', leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(mail.attempts, 6))) } });
    }
  }
}
function start() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await generate(); await deliver(); }
    catch (_) { console.error('Subscription worker failed; retrying on next tick'); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, 60000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
module.exports = { subscription, nextDate, istDate, generate, notify, invoiceNotice, deliver, start };
