const mongoose = require("mongoose");

const examSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    subject: { type: String, required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolClass", required: true },
    examDate: { type: Date, required: true },
    totalMarks: { type: Number, required: true },
    resultsPublished: { type: Boolean, default: false },
    resultsPublishedAt: { type: Date },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("Exam", examSchema);
