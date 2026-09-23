const mongoose = require("mongoose");
const id = mongoose.Schema.Types.ObjectId;
const schema = new mongoose.Schema({
  studentId: { type: id, ref: "Student", required: true },
  classId: { type: id, ref: "SchoolClass", required: true },
  resultId: { type: id, ref: "SectionExamResult" },
  type: { type: String, enum: ["pass_out", "manual"], required: true },
  remark: { type: String, required: true, trim: true },
  status: { type: String, enum: ["in_process", "transferred"], default: "in_process" },
  initiatedBy: { type: id, ref: "User", required: true },
  completedBy: { type: id, ref: "User" },
  completedAt: Date,
}, { timestamps: true });
schema.index({ studentId: 1 }, { unique: true, partialFilterExpression: { status: "in_process" } });
module.exports = require("../tenancy/context").tenantModel("StudentTransfer", schema);
