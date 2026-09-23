const mongoose = require("mongoose");

const timetableEntrySchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolClass" },
    className: { type: String }, // e.g. "2A" or "10th-A"
    grade: { type: String }, // e.g. "2nd Year" or "10th"
    section: { type: String }, // e.g. "A" or "2A (104)"
    session: { type: String, default: "2024-25 (Even Semester)" },
    day: {
      type: String,
      enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      default: "Monday",
    },
    period: { type: Number, required: true },
    periodName: { type: String }, // e.g. "Period 1"
    startTime: { type: String }, // e.g. "09:30 AM"
    endTime: { type: String }, // e.g. "10:20 AM"
    subject: { type: String, required: true },
    subjectCode: { type: String }, // e.g. "DS", "TC", "COA"
    teacherName: { type: String },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher" },
    isBreak: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("TimetableEntry", timetableEntrySchema);
