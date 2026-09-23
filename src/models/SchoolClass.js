const mongoose = require("mongoose");

const schoolClassSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // e.g. "10th-A"
    grade: { type: String, required: true }, // e.g. "10th"
    section: { type: String, required: true }, // e.g. "A"
    classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher" },
    roomNo: { type: String, default: "" },
    gradeBand: { type: String, required: true }, // e.g. "9th - 10th"
    studentCount: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("SchoolClass", schoolClassSchema);
