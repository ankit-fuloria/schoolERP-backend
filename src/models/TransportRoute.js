const mongoose = require("mongoose");

const transportRouteSchema = new mongoose.Schema(
  {
    routeName: { type: String, required: true },
    vehicleNumber: { type: String, required: true },
    driverName: { type: String },
    driverPhone: { type: String },
    capacity: { type: Number },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("TransportRoute", transportRouteSchema);
