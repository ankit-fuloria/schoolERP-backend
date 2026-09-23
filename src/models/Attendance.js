const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    day: { type: String, required: true }, // "Mon", "Tue", ...
    presentPercent: { type: Number, required: true },
    absentPercent: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("Attendance", attendanceSchema);
