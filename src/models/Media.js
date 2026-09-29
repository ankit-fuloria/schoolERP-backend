const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId },
  branchId: { type: mongoose.Schema.Types.ObjectId },
  module: { type: String, required: true, enum: ['students', 'teachers', 'staff', 'transport', 'logos'] },
  purpose: { type: String, required: true, enum: ['photos', 'documents', 'signatures', 'logos'] },
  originalName: { type: String, required: true },
  path: { type: String, required: true },
  mime: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  entityId: mongoose.Schema.Types.ObjectId,
  status: { type: String, enum: ['draft', 'attached', 'deleting'], default: 'draft' },
}, { timestamps: true });
mediaSchema.index({ schoolId: 1, branchId: 1, createdAt: 1 });

module.exports = require('../tenancy/context').tenantModel('Media', mediaSchema);
