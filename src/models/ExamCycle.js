const mongoose = require("mongoose");
const id = mongoose.Schema.Types.ObjectId;
const schema = new mongoose.Schema({
  planId: { type: id, ref: "ExamPlan", required: true },
  structureId: { type: id, required: true },
  sessionId: { type: id, required: true },
  academicYear: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["final", "mid", "sessional"], required: true },
  maxMarks: { type: Number, required: true },
  passMarks: { type: Number, required: true },
  grades: [String],
  dates: [{
    grade: { type: String, required: true },
    subjectId: { type: id, ref: "Subject", required: true },
    subject: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    _id: false,
  }],
  datesheetLive: { type: Boolean, default: false },
  publishedBy: { type: id, ref: "User" },
  publishedAt: Date,
  revision: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ planId: 1, sessionId: 1 }, { unique: true });
module.exports = require("../tenancy/context").tenantModel("ExamCycle", schema);
