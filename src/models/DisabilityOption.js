const mongoose = require("mongoose");

const disabilityOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("DisabilityOption", disabilityOptionSchema);
