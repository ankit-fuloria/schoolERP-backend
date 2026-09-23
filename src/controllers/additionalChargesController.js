const Student = require('../models/Student');
const FeeStructure = require('../models/FeeStructure');
const FeeRecord = require('../models/FeeRecord');
const Transaction = require('../models/Transaction');
const { getSessionMonths } = require('./feesController');
const { chargeStatus } = require('../utils/additionalCharges');
const { connection } = require('../tenancy/context');
const { logAction } = require('../utils/auditLog');
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
async function details(studentId, session) {
  const student = await Student.findById(studentId).populate('classId').session(session || null);
  if (!student) fail(404, 'Student not found');
  const structure = await FeeStructure.findOne().session(session || null);
  const year = getSessionMonths(structure?.sessionStartMonth || 4, new Date())[0].year;
  const academicSession = `${year}-${year + 1}`;
  const records = await FeeRecord.find({ studentId, academicSession }).session(session || null);
  return { student, academicSession, charges: chargeStatus(structure, student, records, academicSession) };
}
async function status(req, res) {
  if (!req.query.studentId) fail(400, 'studentId is required');
  const { academicSession, charges } = await details(req.query.studentId);
  res.json({ academicSession, charges });
}
async function pay(req, res) {
  const { studentId, chargeId, paymentMode, transactionRef } = req.body;
  if (!studentId || !chargeId) fail(400, 'Student and charge are required');
  if (!['cash', 'upi', 'card', 'cheque', 'bank_transfer'].includes(paymentMode)) fail(400, 'Select a valid payment mode');
  if (transactionRef != null && (typeof transactionRef !== 'string' || transactionRef.length > 200)) fail(400, 'Invalid payment reference');
  if (paymentMode === 'upi' && !transactionRef?.trim()) fail(400, 'A UTR / reference number is required for UPI payments');
  await FeeRecord.init();
  const session = await connection().startSession();
  let fee;
  try { await session.withTransaction(async () => {
    const { student, academicSession, charges } = await details(studentId, session);
    await Student.updateOne({ _id: studentId }, { $inc: { paymentRevision: 1 } }, { session });
    const charge = charges.find(c => c.chargeId === chargeId);
    if (!charge) fail(404, 'Charge not found');
    if (charge.status !== 'unpaid') fail(409, 'This charge is already paid, not applicable, or not configured');
    const label = `${charge.name} (${academicSession})`;
    const [transaction] = await Transaction.create([{ studentId, classId: student.classId?._id,
      amount: charge.amount, grossAmount: charge.amount, discountAmount: 0,
      lineItems: [{ kind: 'charge', label, chargeId, grossAmount: charge.amount, discountAmount: 0, amount: charge.amount }],
      monthsCovered: [label], paymentMode, transactionRef }], { session });
    fee = await FeeRecord.findOneAndUpdate({ studentId, chargeId, academicSession }, { $set: {
      classId: student.classId?._id, chargeName: charge.name, amount: charge.amount, month: label,
      status: 'collected', paidDate: new Date(), paymentMode, transactionRef: transactionRef || null,
      transactionId: transaction._id, isActive: true,
    } }, { upsert: true, new: true, runValidators: true, session });
  }); } finally { await session.endSession(); }
  await logAction({ req, entityType: 'FeeRecord', entityId: fee._id, action: 'create', detail: { studentId, chargeId, amount: fee.amount } });
  res.status(201).json(fee);
}
module.exports = { status, pay };
