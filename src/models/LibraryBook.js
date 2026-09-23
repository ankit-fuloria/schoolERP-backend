const mongoose = require("mongoose");

const libraryChapterSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    description: { type: String, trim: true },
    topics: [{ type: String, trim: true }],
    term: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const libraryBookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    author: { type: String, required: true },
    isbn: { type: String },
    category: { type: String },
    totalCopies: { type: Number, default: 1 },
    availableCopies: { type: Number, default: 1 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    chapters: { type: [libraryChapterSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("LibraryBook", libraryBookSchema);
