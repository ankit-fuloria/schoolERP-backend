const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["principal", "staff", "teacher", "parent"],
      required: true,
    },
    phone: { type: String },
    active: { type: Boolean, default: true },
    platformPrincipalId: { type: mongoose.Schema.Types.ObjectId },
    childStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Student" }],
    resetOtp: { type: String },
    resetOtpExpires: { type: Date },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("User", userSchema);
