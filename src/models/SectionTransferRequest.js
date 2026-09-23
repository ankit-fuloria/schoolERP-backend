const mongoose = require("mongoose");

const sectionTransferRequestSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    fromClassId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolClass",
      required: true,
    },
    toClassId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolClass",
      required: true,
    },
    requestedByTeacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    targetTeacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    actionByRole: {
      type: String,
      enum: ["teacher", "principal", "staff"],
    },
    actionByName: {
      type: String,
    },
    actionNote: {
      type: String,
      default: "",
    },
    actionAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel(
  "SectionTransferRequest",
  sectionTransferRequestSchema
);
