const mongoose = require("mongoose");

const gradeFeeSchema = new mongoose.Schema(
  {
    grade: { type: String, required: true, trim: true },
    monthlyFee: { type: Number, default: 0 },
  },
  { _id: false }
);

const reservationDiscountSchema = new mongoose.Schema(
  {
    reservationType: { type: String, required: true, trim: true },
    mode: { type: String, enum: ["percent", "amount"], default: "percent" },
    value: { type: Number, default: 0 },
  },
  { _id: false }
);

// Single-document collection (like SchoolSettings) — there is only ever one
// fee structure for the school, fetched/updated via findOne, never by id.
const feeStructureSchema = new mongoose.Schema(
  {
    sessionStartMonth: { type: Number, min: 1, max: 12, default: 4 },
    gradeFees: [gradeFeeSchema],
    reservationDiscounts: [reservationDiscountSchema],
    additionalCharges: [{
      name: { type: String, required: true, trim: true },
      sameForAll: { type: Boolean, default: true },
      amount: { type: Number, min: 0, default: 0 },
      gradeAmounts: [{ grade: String, amount: { type: Number, min: 0 }, _id: false }],
    }],
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("FeeStructure", feeStructureSchema);
