const crypto = require('node:crypto');
const platform = require('../tenancy/platform');
const { fail } = require('../tenancy/access');
const billing = () => require('./ownerBilling');
function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label} is required (maximum ${max} characters)`);
  return value.trim();
}
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(new Date(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(400, `${label} must be a valid YYYY-MM-DD date`);
  return value;
}
const localDate = value => new Date(new Date(value).getTime() + 330 * 60000).toISOString().slice(0, 10);
async function complete(bill, school, ownerId, session, paymentDate) {
  if (bill.status !== 'paid') return null;
  const { CompletedInvoice } = platform.get();
  const existing = await CompletedInvoice.findOne({ billId: bill._id }).session(session);
  if (existing) return existing;
  const [invoice] = await CompletedInvoice.create([{
    schoolId: bill.schoolId, billId: bill._id, billNumber: bill.number,
    number: `INV-${crypto.randomUUID()}`, schoolName: school.name, schoolCode: school.code,
    description: bill.description, kind: bill.kind, amountMinor: bill.amountMinor,
    subtotalMinor: bill.subtotalMinor ?? bill.amountMinor, discountMinor: bill.discountMinor || 0,
    taxPercent: bill.taxPercent || 0, taxMinor: bill.taxMinor || 0, currency: bill.currency || 'INR',
    periodStart: bill.periodStart, periodEnd: bill.periodEnd, issuedAt: new Date(),
    paymentDate: paymentDate || billing().today(), paymentReference: bill.paymentReference,
    createdBy: ownerId,
  }], { session });
  await require('../tenancy/billing').notify(school, `completed-invoice:${invoice._id}`, `${school.name}: invoice ${invoice.number}`,
    `School: ${invoice.schoolName} (${invoice.schoolCode})\nInvoice: ${invoice.number}\nBill: ${invoice.billNumber}\nType: ${invoice.kind}\n${invoice.description}\nSubtotal: INR ${(invoice.subtotalMinor / 100).toFixed(2)}\nDiscount: INR ${(invoice.discountMinor / 100).toFixed(2)}\nTax: ${invoice.taxPercent}% (INR ${(invoice.taxMinor / 100).toFixed(2)})\nTotal paid: INR ${(invoice.amountMinor / 100).toFixed(2)}\nPayment date: ${invoice.paymentDate}\n${invoice.periodStart ? `Period: ${invoice.periodStart} to ${invoice.periodEnd}\n` : ''}Status: Paid in full\nThis invoice was generated automatically after this bill was fully settled.`, session);
  return invoice;
}
async function recordExpense(input, ownerId) {
  const amountMinor = input.amountMinor;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 100000000000) fail(400, 'Expense must be a positive amount in whole paise');
  const transactionDate = date(input.transactionDate, 'Transaction date');
  if (transactionDate > billing().today()) fail(400, 'Expense transaction date cannot be in the future');
  const value = { amountMinor, transactionDate, category: text(input.category, 'Category', 100),
    payee: text(input.payee, 'Payee'), description: text(input.description, 'Description', 1000),
    method: text(input.method, 'Payment method', 40), reference: text(input.reference, 'Transaction reference'),
    notes: input.notes ? text(input.notes, 'Notes', 1000) : '', requestId: text(input.requestId, 'Request ID', 100) };
  if (!['bank_transfer', 'upi', 'cash', 'cheque', 'other'].includes(value.method)) fail(400, 'Invalid payment method');
  const { Expense } = platform.get();
  const expense = await Expense.findOneAndUpdate({ requestId: value.requestId },
    { $setOnInsert: { ...value, number: `EXP-${crypto.randomUUID()}`, createdBy: ownerId } },
    { upsert: true, new: true, runValidators: true });
  if (Object.entries(value).some(([key, val]) => expense[key] !== val)) fail(409, 'This request ID was already used for another expense');
  return expense;
}
async function voidExpense(id, reason, ownerId) {
  if (!/^[a-f\d]{24}$/i.test(id)) fail(400, 'Invalid expense ID');
  const expense = await platform.get().Expense.findOneAndUpdate({ _id: id, status: 'recorded' },
    { $set: { status: 'void', voidReason: text(reason, 'Void reason', 1000), voidedAt: new Date(), voidedBy: ownerId } }, { new: true });
  if (!expense) fail(409, 'Expense not found or already voided');
  return expense;
}
function filters(query) {
  const startDate = query.startDate ? date(query.startDate, 'Start date') : '1900-01-01';
  const endDate = query.endDate ? date(query.endDate, 'End date') : billing().today();
  if (startDate > endDate) fail(400, 'Start date must not be after end date');
  const page = Number(query.page ?? 1), limit = Number(query.limit ?? 25);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'Invalid pagination');
  const type = query.type || 'all';
  if (!['all', 'expense', 'invoice', 'bill'].includes(type)) fail(400, 'Invalid transaction type');
  return { startDate, endDate, page, limit, type };
}
async function expenses(query) {
  const f = filters(query);
  const filter = { transactionDate: { $gte: f.startDate, $lte: f.endDate } };
  const [items, total] = await Promise.all([
    platform.get().Expense.find(filter).sort({ transactionDate: -1, createdAt: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    platform.get().Expense.countDocuments(filter),
  ]);
  return { items, total, page: f.page, totalPages: Math.max(1, Math.ceil(total / f.limit)) };
}
async function report(query) {
  const f = filters(query);
  // A union keeps bills neutral and counts only completed invoices as income.
  const dateExpr = field => ({ $dateToString: { date: { $ifNull: [field, '$createdAt'] }, format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } });
  const pipeline = [
    { $project: { number: 1, description: 1, status: 1, amountMinor: 1, schoolId: 1,
      date: dateExpr('$issuedAt'), type: { $literal: 'bill' }, signedMinor: { $literal: 0 }, reference: '$paymentReference' } },
    { $unionWith: { coll: platform.get().CompletedInvoice.collection.name, pipeline: [
      { $project: { number: 1, description: 1, amountMinor: 1, schoolId: 1, schoolName: 1, billNumber: 1,
        date: dateExpr('$issuedAt'), type: { $literal: 'invoice' }, status: { $literal: 'paid' }, signedMinor: '$amountMinor', reference: '$paymentReference' } },
    ] } },
    { $unionWith: { coll: platform.get().Expense.collection.name, pipeline: [
      { $project: { number: 1, description: 1, amountMinor: 1, status: 1, category: 1, payee: 1, reference: 1, voidReason: 1,
        date: '$transactionDate', type: { $literal: 'expense' }, signedMinor: { $cond: [{ $eq: ['$status', 'void'] }, 0, { $multiply: ['$amountMinor', -1] }] } } },
    ] } },
    { $unionWith: { coll: platform.get().Invoice.collection.name, pipeline: [
      { $match: { status: 'paid', documentType: { $ne: 'bill' } } },
      { $lookup: { from: platform.get().CompletedInvoice.collection.name, localField: '_id', foreignField: 'billId', as: 'completion' } },
      { $match: { completion: { $size: 0 } } },
      { $project: { number: 1, description: 1, amountMinor: 1, schoolId: 1,
        date: dateExpr('$paidAt'), type: { $literal: 'invoice' }, status: { $literal: 'paid' }, signedMinor: '$amountMinor', reference: '$paymentReference' } },
    ] } },
    { $match: { date: { $gte: f.startDate, $lte: f.endDate }, ...(f.type === 'all' ? {} : { type: f.type }) } },
    { $facet: {
      items: [{ $sort: { date: -1, _id: -1 } }, { $skip: (f.page - 1) * f.limit }, { $limit: f.limit },
        { $lookup: { from: platform.get().School.collection.name, localField: 'schoolId', foreignField: '_id', as: 'school' } },
        { $set: { schoolName: { $ifNull: ['$schoolName', { $arrayElemAt: ['$school.name', 0] }] } } }, { $unset: 'school' }],
      totals: [{ $group: { _id: null, count: { $sum: 1 }, netMinor: { $sum: '$signedMinor' },
        incomeMinor: { $sum: { $cond: [{ $eq: ['$type', 'invoice'] }, '$signedMinor', 0] } },
        expenseMinor: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, { $multiply: ['$signedMinor', -1] }, 0] } },
        billMinor: { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'bill'] }, { $ne: ['$status', 'void'] }] }, '$amountMinor', 0] } } } }],
    } },
  ];
  const [result] = await platform.get().Invoice.aggregate(pipeline);
  const summary = result.totals[0] || { count: 0, netMinor: 0, incomeMinor: 0, expenseMinor: 0, billMinor: 0 };
  delete summary._id;
  return { items: result.items, summary, total: summary.count, page: f.page, totalPages: Math.max(1, Math.ceil(summary.count / f.limit)) };
}
module.exports = { complete, recordExpense, voidExpense, expenses, report };
