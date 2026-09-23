// One-off migration: Subject.books (flat, shared across every class the
// subject is taught in) -> Subject.curriculum: [{ grade, books }] (books
// scoped per grade, since a subject taught in multiple grades can use
// different textbooks per grade). Run once: node scripts/migrateSubjectCurriculum.js
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Subject = require("../src/models/Subject");
const SchoolClass = require("../src/models/SchoolClass");

async function migrate() {
  await connectDB();

  // Read raw documents directly — the current Subject model no longer
  // declares `books`, so a normal Mongoose query wouldn't return it.
  const rawSubjects = await Subject.collection
    .find({ books: { $exists: true, $not: { $size: 0 } } })
    .toArray();

  console.log(`Found ${rawSubjects.length} subject(s) with legacy books data.`);

  for (const raw of rawSubjects) {
    const classes = await SchoolClass.find({ _id: { $in: raw.classIds || [] } }).select("grade");
    const grades = [...new Set(classes.map((c) => c.grade))];

    if (grades.length === 0) {
      console.log(`Skipping "${raw.name}" (${raw._id}) — no classes to infer a grade from.`);
      continue;
    }

    const curriculum = grades.map((grade) => ({ grade, books: raw.books }));

    await Subject.collection.updateOne(
      { _id: raw._id },
      { $set: { curriculum }, $unset: { books: "" } }
    );
    console.log(`Migrated "${raw.name}" (${raw._id}) -> grades: ${grades.join(", ")}`);
  }

  console.log("\nMigration complete.");
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
