const mongoose = require("mongoose");

const classDiarySchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolClass",
      required: true,
    },
    subject: { type: String, required: true },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    teacherName: { type: String, required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD"
    topicTaught: { type: String, required: true },
    classwork: { type: String, default: "" },
    homework: { type: String, default: "" },
    remarks: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("ClassDiary", classDiarySchema);
