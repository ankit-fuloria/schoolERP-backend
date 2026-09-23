const mongoose = require("mongoose");

const attendanceRecordSchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolClass", required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ["present", "absent", "leave", "late", "half_day"], required: true },
    lateTime: { type: String, default: "" },
  },
  { timestamps: true }
);

attendanceRecordSchema.index({ studentId: 1, date: 1 }, { unique: true });

module.exports = require("../tenancy/context").tenantModel("AttendanceRecord", attendanceRecordSchema);
