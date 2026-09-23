const mongoose = require("mongoose");

const chapterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    topics: [{ type: String, trim: true }],
    // Term is now a free string — values are managed via /api/settings/terms
    term: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const bookSchema = new mongoose.Schema(
  {
    // Books are created/owned by the Library, never by a Subject — this is
    // a reference plus a denormalized title snapshot (so a later library
    // rename doesn't rewrite every subject that mapped it), not a new book.
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "LibraryBook", required: true },
    name: { type: String, required: true, trim: true },
    chapters: [chapterSchema],
  },
  { _id: false }
);

const gradeCurriculumSchema = new mongoose.Schema(
  {
    grade: { type: String, required: true, trim: true },
    books: [bookSchema],
  },
  { _id: false }
);

const gradeLectureConfigSchema = new mongoose.Schema(
  {
    grade: { type: String, required: true, trim: true },
    lecturesPerWeek: { type: Number, required: true, default: 5 },
    preferredPeriod: { type: Number }, // Optional preferred period (e.g. Period 1)
  },
  { _id: false }
);

const subjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String },
    description: { type: String },
    classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "SchoolClass" }],
    // Books/chapters are grade-specific — a subject taught in multiple
    // grades (e.g. Math in 6th and 9th) can use different books per grade.
    curriculum: [gradeCurriculumSchema],
    // Weekly lecture requirement per grade (e.g. 8th grade Math: 6 lectures/week, preferred period 1)
    weeklyLectures: [gradeLectureConfigSchema],
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("Subject", subjectSchema);
