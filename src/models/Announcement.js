const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    category: {
      type: String,
      enum: ["notice", "event", "exam", "meeting"],
      default: "notice",
    },
    audience: { type: String, enum: ["school", "class"], default: "school" },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolClass" },
    createdByName: { type: String },
    createdByRole: {
      type: String,
      enum: ["principal", "staff", "teacher"],
      default: "principal",
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("Announcement", announcementSchema);
