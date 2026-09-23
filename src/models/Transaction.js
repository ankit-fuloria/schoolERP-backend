const mongoose = require("mongoose");

// One real-world payment event, which can settle several months of fees at
// once — kept separate from FeeRecord (one doc per month) so the payment
// history shows one line per actual payment, not one per month it covered.
const transactionSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolClass" },
    amount: { type: Number, required: true },
    grossAmount: Number,
    discountMode: { type: String, enum: ['amount', 'percent'] },
    discountValue: Number,
    discountAmount: Number,
    lineItems: [{ label: String, kind: String, chargeId: mongoose.Schema.Types.ObjectId,
      grossAmount: Number, discountAmount: Number, amount: Number, _id: false }],
    monthsCovered: [{ type: String }],
    paymentMode: {
      type: String,
      enum: ["cash", "upi", "card", "cheque", "bank_transfer"],
    },
    transactionRef: { type: String },
    remarks: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("Transaction", transactionSchema);
