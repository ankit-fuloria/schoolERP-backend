const mongoose = require('mongoose');
const SchoolClass = require('../models/SchoolClass');
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
function money(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) fail('Charge amounts must be non-negative amounts with at most two decimals');
  return value;
}
async function normalizeCharges(input, existing) {
  if (!Array.isArray(input) || input.length > 100) fail('Provide up to 100 charge types');
  const grades = await SchoolClass.distinct('grade', { status: { $ne: 'inactive' } });
  const ids = new Set(), names = new Set();
  return input.map(charge => {
    if (!charge || typeof charge.name !== 'string' || !charge.name.trim() || charge.name.trim().length > 100) fail('Charge name is required (up to 100 characters)');
    const name = charge.name.trim();
    if (names.has(name.toLowerCase())) fail('Charge names must be unique');
    names.add(name.toLowerCase());
    const id = charge._id || new mongoose.Types.ObjectId().toString();
    if (charge._id && !existing.some(c => String(c._id) === id)) fail('Unknown charge type');
    if (ids.has(id)) fail('Duplicate charge type');
    ids.add(id);
    if (typeof charge.sameForAll !== 'boolean') fail('Select whether the charge is the same for all classes');
    if (charge.sameForAll) return { _id: id, name, sameForAll: true, amount: money(charge.amount), gradeAmounts: [] };
    if (!Array.isArray(charge.gradeAmounts)) fail('Provide an amount for each class');
    const seen = new Set();
    const gradeAmounts = charge.gradeAmounts.map(g => {
      if (!g || typeof g.grade !== 'string' || !g.grade.trim() || seen.has(g.grade)) fail('Invalid or duplicate class');
      seen.add(g.grade);
      return { grade: g.grade, amount: money(g.amount) };
    });
    if (grades.some(g => g && !seen.has(g))) fail('Provide an amount for each class');
    return { _id: id, name, sameForAll: false, amount: 0, gradeAmounts };
  });
}
function chargeStatus(structure, student, records, session) {
  const paid = new Map(records.filter(r => r.chargeId && r.academicSession === session && r.isActive !== false && r.status === 'collected').map(r => [String(r.chargeId), r]));
  const result = (structure?.additionalCharges || []).map(c => {
    const record = paid.get(String(c._id));
    const amount = c.sameForAll ? c.amount : c.gradeAmounts.find(g => g.grade === student.classId?.grade)?.amount;
    return { chargeId: String(c._id), name: record?.chargeName || c.name,
      amount: record?.amount ?? amount ?? null, status: record ? 'paid' : amount == null ? 'not_configured' : amount === 0 ? 'not_applicable' : 'unpaid',
      grossAmount: record?.grossAmount ?? amount ?? null, discountAmount: record?.discountAmount ?? 0,
      paidDate: record?.paidDate || null, paymentMode: record?.paymentMode || null,
      transactionRef: record?.transactionRef || null, feeRecordId: record?._id || null, academicSession: session };
  });
  for (const [id, record] of paid) {
    if (!result.some(c => c.chargeId === id)) result.push({ chargeId: id, name: record.chargeName,
      amount: record.amount, grossAmount: record.grossAmount ?? record.amount,
      discountAmount: record.discountAmount ?? 0, status: 'paid', paidDate: record.paidDate,
      academicSession: session, archived: true });
  }
  return result;
}
module.exports = { normalizeCharges, chargeStatus };
