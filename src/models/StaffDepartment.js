const mongoose = require('mongoose');
const { tenantModel } = require('../tenancy/context');
module.exports = tenantModel('StaffDepartment', new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  key: { type: String, required: true, unique: true },
}, { timestamps: true }));
