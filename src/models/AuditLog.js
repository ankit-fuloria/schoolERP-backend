const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, index: true },
    branchName: { type: String },
    entityType: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.Mixed, index: true },
    action: {
      type: String,
      required: true,
      index: true,
    },
    performedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      role: { type: String, default: "user" },
      name: { type: String, default: "Unknown" },
      email: { type: String },
    },
    detail: { type: mongoose.Schema.Types.Mixed },
    note: { type: String },
    ipAddress: { type: String },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1, entityType: 1 });
auditLogSchema.index({ createdAt: -1, action: 1 });

module.exports = require("../tenancy/context").tenantModel("AuditLog", auditLogSchema);
