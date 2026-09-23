const mongoose = require("mongoose");

const hostelRoomSchema = new mongoose.Schema(
  {
    roomNumber: { type: String, required: true },
    block: { type: String, required: true },
    capacity: { type: Number, required: true },
    occupied: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("HostelRoom", hostelRoomSchema);
