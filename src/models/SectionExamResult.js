const mongoose = require("mongoose");
const id = mongoose.Schema.Types.ObjectId;
const schema = new mongoose.Schema({
  cycleId: { type: id, ref: "ExamCycle", required: true },
  classId: { type: id, ref: "SchoolClass", required: true },
  className: { type: String, required: true },
  grade: { type: String, required: true },
  section: { type: String, required: true },
  status: { type: String, enum: ["draft", "submitted", "approved", "live"], default: "draft" },
  subjects: [{
    subjectId: { type: id, ref: "Subject", required: true },
    name: String,
    endsAt: Date,
    submitted: { type: Boolean, default: false },
    submittedBy: { type: id, ref: "User" },
    submittedAt: Date,
    _id: false,
  }],
  students: [{
    studentId: { type: id, ref: "Student", required: true },
    name: String,
    admissionNo: String,
    decision: { type: String, enum: ["pass", "fail"] },
    remark: String,
    marks: [{
      subjectId: { type: id, ref: "Subject", required: true },
      marksObtained: { type: Number, required: true, min: 0 },
      grade: { type: String, required: true },
      remarks: String,
      _id: false,
    }],
    _id: false,
  }],
  approvedBy: { type: id, ref: "User" },
  approvedAt: Date,
  publishedBy: { type: id, ref: "User" },
  publishedAt: Date,
  revision: { type: Number, default: 0 },
  promotion: {
    completed: { type: Boolean, default: false },
    targetClassId: { type: id, ref: "SchoolClass" },
    passOut: { type: Boolean, default: false },
    movedStudentIds: [{ type: id, ref: "Student" }],
    skippedStudentIds: [{ type: id, ref: "Student" }],
    completedAt: Date,
    completedBy: { type: id, ref: "User" },
  },
}, { timestamps: true });
schema.index({ cycleId: 1, classId: 1 }, { unique: true });
schema.index({ "students.studentId": 1, status: 1 });
module.exports = require("../tenancy/context").tenantModel("SectionExamResult", schema);
