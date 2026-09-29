const FeeRecord = require("../models/FeeRecord");
const Student = require("../models/Student");
const FeeStructure = require("../models/FeeStructure");
const Transaction = require("../models/Transaction");
const { logAction } = require("../utils/auditLog");
const { chargeStatus } = require('../utils/additionalCharges');
const { connection } = require('../tenancy/context');

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The 12 {monthIndex, year, label} slots of the session that contains
// `referenceDate`, starting at `sessionStartMonth` (1-12).
function getSessionMonths(sessionStartMonth, referenceDate) {
  const refMonth = referenceDate.getMonth() + 1;
  const refYear = referenceDate.getFullYear();
  const sessionStartYear = refMonth >= sessionStartMonth ? refYear : refYear - 1;

  const months = [];
  for (let i = 0; i < 12; i++) {
    const monthIndex = ((sessionStartMonth - 1 + i) % 12) + 1;
    const year = sessionStartYear + Math.floor((sessionStartMonth - 1 + i) / 12);
    months.push({ monthIndex, year, label: `${MONTH_NAMES[monthIndex - 1]} ${year}` });
  }
  return months;
}

// The effective monthly fee for a student: their grade's configured fee,
// minus a matching reservation discount if they have one. Falls back to 0
// when no fee structure or grade fee is configured yet.
function computeMonthlyFee(structure, student) {
  const grade = student.classId?.grade;
  if (!structure || !grade) return 0;

  const gradeFee = structure.gradeFees.find((g) => g.grade === grade);
  let amount = gradeFee ? gradeFee.monthlyFee : 0;

  if (student.hasReservation && student.reservationType) {
    const discount = structure.reservationDiscounts.find(
      (d) => d.reservationType === student.reservationType
    );
    if (discount) {
      amount = discount.mode === "percent" ? amount - (amount * discount.value) / 100 : amount - discount.value;
      if (amount < 0) amount = 0;
    }
  }
  return amount;
}

function serializeFee(f) {
  // Prefer the record's own frozen classId; fall back to the student's
  // current class for legacy records created before classId existed.
  const classRef = f.classId || (f.studentId ? f.studentId.classId : null);
  return {
    id: f._id,
    student: f.studentId
      ? {
          id: f.studentId._id,
          name: f.studentId.name,
          admissionNo: f.studentId.admissionNo,
          className: f.studentId.classId ? f.studentId.classId.name : null,
        }
      : null,
    classId: classRef ? classRef._id : null,
    className: classRef ? classRef.name : null,
    amount: f.amount,
    status: f.status,
    month: f.month,
    dueDate: f.dueDate,
    paidDate: f.paidDate,
    paymentMode: f.paymentMode || null,
    transactionRef: f.transactionRef || null,
    remarks: f.remarks || null,
    isActive: f.isActive,
  };
}

const FEE_POPULATE = [
  { path: "studentId", select: "name admissionNo classId", populate: { path: "classId", select: "name" } },
  { path: "classId", select: "name" },
];

async function listFees(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const { search, status, month, studentId, includeInactive } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (month) filter.month = month;
  if (studentId) filter.studentId = studentId;
  if (!includeInactive) filter.isActive = { $ne: false };

  if (search) {
    const matchingStudents = await Student.find({
      $or: [
        { name: { $regex: search, $options: "i" } },
        { admissionNo: { $regex: search, $options: "i" } },
      ],
    }).select("_id");
    filter.studentId = { $in: matchingStudents.map((s) => s._id) };
  }

  const [fees, total] = await Promise.all([
    FeeRecord.find(filter)
      .populate(FEE_POPULATE)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    FeeRecord.countDocuments(filter),
  ]);

  res.json({
    items: fees.map(serializeFee),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

async function getFeesSummary(req, res) {
  const records = await FeeRecord.find({ isActive: { $ne: false } });
  const sum = (status) => records.filter((r) => r.status === status).reduce((s, r) => s + r.amount, 0);
  const collected = sum("collected");
  const pending = sum("pending");
  const overdue = sum("overdue");

  res.json({
    total: collected + pending + overdue,
    collected,
    pending,
    overdue,
  });
}

// The current session's month-by-month status for a student: "paid" when a
// (non-disabled) FeeRecord exists for that month, otherwise derived purely
// from today's date — overdue if the month is in the past, pending if it's
// the current month, upcoming otherwise. There is no stored "pending" or
// "overdue" state going forward; absence of a record IS that state.
async function getMonthlyStatus(req, res) {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ message: "studentId is required" });

  const student = await Student.findById(studentId).populate("classId");
  if (!student) return res.status(404).json({ message: "Student not found" });

  const [structure, feeRecords] = await Promise.all([
    FeeStructure.findOne(),
    FeeRecord.find({ studentId, chargeId: { $exists: false }, isActive: { $ne: false } }),
  ]);

  const sessionStartMonth = structure?.sessionStartMonth || 4;
  const monthlyFee = computeMonthlyFee(structure, student);
  const now = new Date();
  const months = getSessionMonths(sessionStartMonth, now);
  const nowMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const recordByMonth = new Map(feeRecords.map((r) => [r.month, r]));

  const result = months.map((m) => {
    const record = recordByMonth.get(m.label);
    if (record && record.status === "collected") {
      return {
        month: m.label,
        status: "paid",
        amount: record.amount,
        feeRecordId: record._id,
        transactionId: record.transactionId || null,
      };
    }
    const monthDate = new Date(m.year, m.monthIndex - 1, 1);
    const status =
      monthDate.getTime() === nowMonthDate.getTime()
        ? "pending"
        : monthDate < nowMonthDate
          ? "overdue"
          : "upcoming";
    return { month: m.label, status, amount: monthlyFee, feeRecordId: null, transactionId: null };
  });

  res.json({ months: result, sessionStartMonth, monthlyFee });
}

// Settles `monthsCount` months starting from the oldest unpaid month —
// overdue first, then the current month, then future months in advance —
// as one Transaction, creating/updating one FeeRecord per month it covers.
async function createPayment(req, res) {
  const { studentId, monthsCount, paymentMode, transactionRef, remarks,
    chargeIds = [], discountMode = 'amount', discountValue = 0 } = req.body;
  const count = Number(monthsCount);
  if (!studentId || !Number.isInteger(count) || count < 0 || count > 12 ||
      !Array.isArray(chargeIds) || chargeIds.length > 100 ||
      chargeIds.some(id => typeof id !== 'string') ||
      new Set(chargeIds).size !== chargeIds.length ||
      (count === 0 && chargeIds.length === 0)) {
    return res.status(400).json({ message: 'Select months or other charges to pay' });
  }
  if (!['cash', 'upi', 'card', 'cheque', 'bank_transfer'].includes(paymentMode) ||
      (paymentMode === 'upi' && !String(transactionRef || '').trim()) ||
      (transactionRef != null && (typeof transactionRef !== 'string' || transactionRef.length > 200)) ||
      (remarks != null && (typeof remarks !== 'string' || remarks.length > 1000))) {
    return res.status(400).json({ message: 'Invalid payment details or missing UPI reference' });
  }
  if (!['amount', 'percent'].includes(discountMode) ||
      typeof discountValue !== 'number' || !Number.isFinite(discountValue) ||
      discountValue < 0 || (discountMode === 'percent' && discountValue > 100) ||
      Math.abs(discountValue * 100 - Math.round(discountValue * 100)) > 0.000001) {
    return res.status(400).json({ message: 'Enter a valid amount or percentage discount' });
  }
  const cents = value => Math.round(value * 100);
  await FeeRecord.init();
  const session = await connection().startSession();
  let transaction, selectedMonths, student;
  try {
    await session.withTransaction(async () => {
      student = await Student.findById(studentId).populate('classId').session(session);
      if (!student) { const error = new Error('Student not found'); error.status = 404; throw error; }
      // A write to the student's ledger revision serializes concurrent payments.
      await Student.updateOne({ _id: studentId }, { $inc: { paymentRevision: 1 } }, { session });
      const structure = await FeeStructure.findOne().session(session);
      const now = new Date();
      const months = getSessionMonths(structure?.sessionStartMonth || 4, now);
      const records = await FeeRecord.find({ studentId, isActive: { $ne: false } }).session(session);
      const recordByMonth = new Map(records.filter(r => !r.chargeId).map(r => [r.month, r]));
      selectedMonths = months.filter(m => recordByMonth.get(m.label)?.status !== 'collected').slice(0, count);
      if (selectedMonths.length !== count) { const error = new Error('Requested months are already paid'); error.status = 409; throw error; }
      const year = months[0].year;
      const academicSession = `${year}-${year + 1}`;
      const available = chargeStatus(structure, student, records, academicSession);
      const selectedCharges = chargeIds.map(id => available.find(c => c.chargeId === id));
      if (selectedCharges.some(c => !c || c.status !== 'unpaid')) {
        const error = new Error('A selected charge is already paid or no longer available'); error.status = 409; throw error;
      }
      const monthlyAmount = cents(computeMonthlyFee(structure, student));
      const lines = [
        ...selectedMonths.map(m => ({ kind: 'month', label: m.label, gross: monthlyAmount })),
        ...selectedCharges.map(c => ({ kind: 'charge', label: `${c.name} (${academicSession})`,
          chargeId: c.chargeId, gross: cents(c.amount), academicSession, chargeName: c.name })),
      ];
      const gross = lines.reduce((sum, line) => sum + line.gross, 0);
      if (!gross || !Number.isSafeInteger(gross)) { const error = new Error('Payment total must be positive'); error.status = 400; throw error; }
      const discount = discountMode === 'percent'
        ? Math.round(gross * discountValue / 100) : cents(discountValue);
      if (discount > gross) { const error = new Error('Discount cannot exceed the charges'); error.status = 400; throw error; }
      let running = 0, allocated = 0;
      for (const line of lines) {
        running += line.gross;
        const cumulative = Math.round(discount * running / gross);
        line.discount = cumulative - allocated;
        line.net = line.gross - line.discount;
        allocated = cumulative;
      }
      [transaction] = await Transaction.create([{
        studentId, classId: student.classId?._id, amount: (gross - discount) / 100,
        grossAmount: gross / 100, discountMode, discountValue, discountAmount: discount / 100,
        lineItems: lines.map(l => ({ kind: l.kind, label: l.label, chargeId: l.chargeId,
          grossAmount: l.gross / 100, discountAmount: l.discount / 100, amount: l.net / 100 })),
        monthsCovered: lines.map(l => l.label), paymentMode, transactionRef: transactionRef || undefined,
        remarks: remarks || undefined,
      }], { session });
      for (const line of lines) {
        const fields = { studentId, classId: student.classId?._id, month: line.label,
          amount: line.net / 100, grossAmount: line.gross / 100,
          discountAmount: line.discount / 100, status: 'collected', paidDate: now,
          paymentMode, transactionRef: transactionRef || undefined, transactionId: transaction._id,
          isActive: true };
        if (line.kind === 'charge') {
          await FeeRecord.findOneAndUpdate({ studentId, chargeId: line.chargeId, academicSession },
            { $set: { ...fields, chargeName: line.chargeName } },
            { upsert: true, new: true, runValidators: true, session });
        } else {
          const old = recordByMonth.get(line.label);
          if (old) await FeeRecord.updateOne({ _id: old._id }, { $set: fields }, { session });
          else await FeeRecord.create([fields], { session });
        }
      }
    });
  } catch (error) {
    if (error.code === 11000 || error.code === 112 || error.hasErrorLabel?.('TransientTransactionError')) {
      error.status = 409;
      error.message = 'Payment changed while recording. Refresh and try again.';
    }
    throw error;
  } finally { await session.endSession(); }
  await logAction({
    req,
    entityType: 'Transaction',
    entityId: transaction._id,
    action: 'create',
    detail: {
      studentName: student.name,
      className: student.classId?.name,
      admissionNo: student.admissionNo,
      monthsCovered: transaction.monthsCovered,
      amount: transaction.amount,
      discountAmount: transaction.discountAmount,
      paymentMode,
      transactionRef: transactionRef || undefined,
      remarks: remarks || undefined,
    },
    note: `Fee payment of ₹${transaction.amount} collected for ${student.name} (${transaction.monthsCovered.join(', ')}) via ${paymentMode.toUpperCase()}`,
  });
  res.status(201).json({ transaction, monthsCovered: transaction.monthsCovered,
    amount: transaction.amount });
}

async function listTransactions(req, res) {
  const { studentId } = req.query;
  const filter = { isActive: { $ne: false } };
  if (studentId) filter.studentId = studentId;

  const transactions = await Transaction.find(filter).sort({ createdAt: -1 }).limit(100);
  res.json({ items: transactions });
}

async function createFee(req, res) {
  const { studentId, amount, status, month, paymentMode, transactionRef } = req.body;
  if (!studentId || !amount || !status || !month) {
    return res.status(400).json({ message: "studentId, amount, status and month are required" });
  }
  if (paymentMode === "upi" && !transactionRef) {
    return res.status(400).json({ message: "A UTR / reference number is required for UPI payments" });
  }

  const student = await Student.findById(studentId);
  if (!student) {
    return res.status(400).json({ message: "Selected student does not exist" });
  }

  const fee = await FeeRecord.create({
    studentId,
    // Frozen at creation time — never re-derived from the student's class
    // later, so promotions don't retroactively change historical records.
    classId: student.classId,
    amount,
    status,
    month,
    dueDate: req.body.dueDate,
    paidDate: status === "collected" ? req.body.paidDate || new Date() : undefined,
    paymentMode: paymentMode || undefined,
    transactionRef: transactionRef || undefined,
    remarks: req.body.remarks || undefined,
  });

  const populated = await FeeRecord.findById(fee._id).populate(FEE_POPULATE);

  await logAction({
    req,
    entityType: "FeeRecord",
    entityId: fee._id,
    action: "create",
    detail: { studentId, amount, status, month, paymentMode, transactionRef },
  });
  res.status(201).json(serializeFee(populated));
}

// "Delete" only disables the fee record (isActive: false) so financial
// history is preserved for audit purposes. Re-enable via PUT {isActive: true}.
async function disableFee(req, res) {
  const fee = await FeeRecord.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  ).populate(FEE_POPULATE);
  if (!fee) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  await logAction({ req, entityType: "FeeRecord", entityId: fee._id, action: "disable" });
  res.json(serializeFee(fee));
}

async function updateFee(req, res) {
  const existing = await FeeRecord.findById(req.params.id);
  if (existing?.chargeId && Object.keys(req.body).some(key => key !== 'isActive')) {
    return res.status(400).json({ message: 'Charge payment details are immutable. Disable an incorrect record and record a new payment.' });
  }
  if ('chargeId' in req.body || 'academicSession' in req.body || 'chargeName' in req.body) {
    return res.status(400).json({ message: 'Use charge-payment to record additional charges' });
  }
  const fee = await FeeRecord.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  }).populate(FEE_POPULATE);
  if (!fee) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  await logAction({
    req,
    entityType: "FeeRecord",
    entityId: fee._id,
    action: "update",
    detail: req.body,
  });
  res.json(serializeFee(fee));
}

module.exports = {
  getSessionMonths,
  computeMonthlyFee,
  listFees,
  getFeesSummary,
  getMonthlyStatus,
  createPayment,
  listTransactions,
  createFee,
  disableFee,
  updateFee,
};
