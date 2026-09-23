const mongoose = require("mongoose");

const lecturePeriodSchema = new mongoose.Schema(
  {
    periodNo: { type: Number, required: true },
    name: { type: String, default: "" },
    startTime: { type: String, default: "09:30 AM" },
    endTime: { type: String, default: "10:20 AM" },
    durationMinutes: { type: Number, default: 50 },
    isBreak: { type: Boolean, default: false },
  },
  { _id: false }
);

const salaryConfigSchema = new mongoose.Schema(
  {
    schoolStartTime: { type: String, default: "08:30" },
    schoolEndTime: { type: String, default: "15:30" },
    lateGraceMinutes: { type: Number, default: 10 },
    schoolLatitude: { type: Number, default: 28.6139 },
    schoolLongitude: { type: Number, default: 77.2090 },
    allowedRadiusMeters: { type: Number, default: 50 },
    lateDeductionPercent: { type: Number, default: 50 },
    lateDaysPerHalfDay: { type: Number, default: 3, min: 1 },
    halfDayDeductionType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    halfDayDeductionValue: { type: Number, default: 50, min: 0 },
  },
  { _id: false }
);

const schoolSettingsSchema = new mongoose.Schema(
  {
    schoolName: { type: String, default: "School ERP" },
    branchName: { type: String, default: "Main Branch" },
    branchAddress: { type: String, default: "" },
    address: { type: String },
    contactEmail: { type: String },
    contactPhone: { type: String },
    academicYear: { type: String },
    affiliationNo: { type: String, default: "" },
    terms: { type: [String], default: ["term1", "term2"] },
    lecturePeriods: { type: [lecturePeriodSchema], default: [] },
    workingDays: {
      type: [String],
      default: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    },
    salaryConfig: { type: salaryConfigSchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("SchoolSettings", schoolSettingsSchema);
