const FeeStructure = require("../models/FeeStructure");
const { logAction } = require("../utils/auditLog");
const { normalizeCharges } = require('../utils/additionalCharges');

function normalizeGradeFees(gradeFees) {
  if (!Array.isArray(gradeFees)) return [];
  return gradeFees
    .map((g) => ({
      grade: String(g.grade || "").trim(),
      monthlyFee: Number(g.monthlyFee) || 0,
    }))
    .filter((g) => g.grade);
}

function normalizeReservationDiscounts(discounts) {
  if (!Array.isArray(discounts)) return [];
  return discounts
    .map((d) => ({
      reservationType: String(d.reservationType || "").trim(),
      mode: d.mode === "amount" ? "amount" : "percent",
      value: Number(d.value) || 0,
    }))
    .filter((d) => d.reservationType);
}

function normalizeSessionStartMonth(value, fallback) {
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : fallback;
}

async function getFeeStructure(req, res) {
  let structure = await FeeStructure.findOne();
  if (!structure) {
    structure = await FeeStructure.create({});
  }
  res.json(structure);
}

async function updateFeeStructure(req, res) {
  let structure = await FeeStructure.findOne();
  const body = {
    sessionStartMonth: normalizeSessionStartMonth(
      req.body.sessionStartMonth,
      structure?.sessionStartMonth ?? 4
    ),
    gradeFees: normalizeGradeFees(req.body.gradeFees),
    reservationDiscounts: normalizeReservationDiscounts(req.body.reservationDiscounts),
    additionalCharges: req.body.additionalCharges === undefined
      ? (structure?.additionalCharges || []).map(c => c.toObject())
      : await normalizeCharges(req.body.additionalCharges, structure?.additionalCharges || []),
  };

  if (!structure) {
    structure = await FeeStructure.create(body);
  } else {
    Object.assign(structure, body);
    await structure.save();
  }

  await logAction({
    req,
    entityType: "FeeStructure",
    entityId: structure._id,
    action: "update",
    detail: body,
  });
  res.json(structure);
}

module.exports = { getFeeStructure, updateFeeStructure };
