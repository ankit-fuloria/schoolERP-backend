const mongoose = require("mongoose");

const feeRecordSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    // Captured once at creation from the student's class at that moment —
    // never re-derived later, so a promotion doesn't retroactively change
    // which class an old fee record belonged to.
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolClass" },
    amount: { type: Number, required: true },
    grossAmount: Number,
    discountAmount: Number,
    chargeId: { type: mongoose.Schema.Types.ObjectId },
    chargeName: String,
    academicSession: String,
    status: {
      type: String,
      enum: ["collected", "pending", "overdue"],
      required: true,
    },
    month: { type: String, required: true }, // e.g. "June 2026"
    dueDate: { type: Date },
    paidDate: { type: Date },
    paymentMode: {
      type: String,
      enum: ["cash", "upi", "card", "cheque", "bank_transfer"],
    },
    transactionRef: { type: String }, // UTR for UPI, cheque/reference number otherwise
    // The payment event that settled this month, if paid via the multi-month
    // payment flow rather than a legacy single-month entry.
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    remarks: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

feeRecordSchema.index({ studentId: 1, chargeId: 1, academicSession: 1 }, {
  unique: true, partialFilterExpression: { chargeId: { $type: 'objectId' } },
});
module.exports = require("../tenancy/context").tenantModel("FeeRecord", feeRecordSchema);
