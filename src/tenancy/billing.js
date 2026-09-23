const crypto = require('node:crypto');
const platform = require('./platform');
const { fail } = require('./access');
const months = { monthly: 1, quarterly: 3, annually: 12 };
const day = 86400000;
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
  await notify(school, `invoice:${invoice._id}:${invoice.status}`, `${school.name}: bill ${invoice.number} ${invoice.status}`,
    `School: ${school.name} (${school.code})\nBill: ${invoice.number}\n${invoice.description}\nAmount: INR ${(invoice.amountMinor / 100).toFixed(2)}\nDue: ${invoice.dueDate} (IST)\nStatus: ${invoice.status}\nUnpaid overdue bills suspend ERP access for all branches.`, session);
}
async function generate(now = new Date()) {
  const { School, Invoice } = platform.get();
  const today = istDate(now);
  const schools = await School.find({ active: true, 'subscription.nextBillingDate': { $lte: today } }).select('_id');
  for (const item of schools) {
    // Bounded catch-up prevents a long outage from monopolizing the worker.
    for (let i = 0; i < 120; i++) {
      const session = await platform.connection().startSession();
      let more = false;
      try {
        await session.withTransaction(async () => {
          const school = await School.findById(item._id).session(session);
          const s = school?.subscription;
          more = false;
          if (!school?.active || !s?.nextBillingDate || s.nextBillingDate > today) return;
          const dueDate = istDate(new Date(now.getTime() + 15 * day));
          const maintenance = s.monthlyMaintenanceMinor * months[s.cycle];
          const [invoice] = await Invoice.create([{
            schoolId: school._id, number: `INV-${crypto.randomUUID()}`,
            description: `${s.cycle} ERP subscription (${s.nextBillingDate})`,
            billingDate: s.nextBillingDate, cycle: s.cycle, cycleAmountMinor: s.cycleAmountMinor,
            maintenanceAmountMinor: maintenance, amountMinor: s.cycleAmountMinor + maintenance,
            dueDate, dueAt: new Date(`${dueDate}T23:59:59.999+05:30`),
            createdBy: s.createdBy, updatedBy: s.createdBy,
          }], { session });
          s.nextBillingDate = nextDate(s.nextBillingDate, s.cycle, s.firstBillingDate);
          await school.save({ session });
          await invoiceNotice(school, invoice, session);
          more = s.nextBillingDate <= today;
        });
      } catch (error) {
        // A competing worker already generated this cycle; retry on the next tick.
        if (error.code !== 11000) throw error;
      } finally { await session.endSession(); }
      if (!more) break;
    }
  }
  const overdue = await Invoice.find({ status: 'unpaid', dueAt: { $lt: now } });
  for (const invoice of overdue) {
    const school = await School.findById(invoice.schoolId);
    if (school) await notify(school, `overdue:${invoice._id}`, `${school.name}: subscription overdue`,
      `Bill ${invoice.number} for INR ${(invoice.amountMinor / 100).toFixed(2)} was due ${invoice.dueDate}. ERP access is suspended until payment is recorded.`);
  }
}
let transport;
async function deliver(send) {
  if (!send) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return;
    transport ||= require('nodemailer').createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }, connectionTimeout: 15000, socketTimeout: 30000 });
    send = message => transport.sendMail(message);
  }
  const { Mail } = platform.get();
  for (let i = 0; i < 50; i++) {
    const now = new Date();
    const mail = await Mail.findOneAndUpdate({ sentAt: null, nextAttemptAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
    { $set: { leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
    if (!mail) break;
    try {
      await send({ from: process.env.SMTP_USER, to: mail.to, subject: mail.subject, text: mail.text,
        messageId: `<${mail._id}@schoolo.erp>` });
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
