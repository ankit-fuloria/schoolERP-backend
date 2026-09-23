const mongoose = require("mongoose");
const { validateStructures } = require("../utils/examPolicy");

const sessionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ["final", "mid", "sessional"], required: true },
  maxMarks: { type: Number, required: true, min: 1 },
  passMarks: { type: Number, required: true, min: 0 },
});
const structureSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  grades: [{ type: String, trim: true }],
  sessions: [sessionSchema],
});
const schema = new mongoose.Schema({
  academicYear: { type: String, required: true, unique: true, trim: true },
  structures: [structureSchema],
  revision: { type: Number, default: 0 },
}, { timestamps: true, optimisticConcurrency: true });
schema.pre("validate", function () { validateStructures(this.structures); });
module.exports = require("../tenancy/context").tenantModel("ExamPlan", schema);
