const mongoose = require("mongoose");

const teacherAttendanceSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    checkInTime: { type: Date },
    checkInLatitude: { type: Number },
    checkInLongitude: { type: Number },
    checkInPlace: { type: String },

    checkOutTime: { type: Date },
    checkOutLatitude: { type: Number },
    checkOutLongitude: { type: Number },
    checkOutPlace: { type: String },

    status: {
      type: String,
      enum: ["present", "late", "half_day", "absent", "leave"],
      default: "present",
    },
    lateMinutes: { type: Number, default: 0 },
    deductionAmount: { type: Number, default: 0 },
    distanceFromSchoolMeters: { type: Number, default: 0 },
  },
  { timestamps: true }
);

teacherAttendanceSchema.index({ teacherId: 1, date: 1 }, { unique: true });

module.exports = require("../tenancy/context").tenantModel("TeacherAttendance", teacherAttendanceSchema);
