// One-off migration: Subject.curriculum[].books[] used to be created inline
// (just a free-typed `name` + chapters). Books are now owned exclusively by
// the Library, so every book entry needs a `bookId` reference — this backs
// each old book with a matching (or newly created) LibraryBook record and
// stamps its id onto the existing curriculum entry, keeping all chapters.
// Run once: node scripts/migrateSubjectBooksToLibrary.js
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Subject = require("../src/models/Subject");
const LibraryBook = require("../src/models/LibraryBook");

async function migrate() {
  await connectDB();

  const rawSubjects = await Subject.collection.find({ curriculum: { $exists: true, $not: { $size: 0 } } }).toArray();
  console.log(`Found ${rawSubjects.length} subject(s) with curriculum data.`);

  const bookIdByName = new Map();

  async function findOrCreateLibraryBook(name) {
    const key = name.trim().toLowerCase();
    if (bookIdByName.has(key)) return bookIdByName.get(key);

    let book = await LibraryBook.findOne({ title: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
    if (!book) {
      book = await LibraryBook.create({ title: name.trim(), author: "Unknown" });
      console.log(`  Created library book "${book.title}" (${book._id})`);
    }
    bookIdByName.set(key, book._id);
    return book._id;
  }

  let migratedSubjects = 0;
  let migratedBooks = 0;

  for (const raw of rawSubjects) {
    let changed = false;
    const curriculum = raw.curriculum || [];

    for (const entry of curriculum) {
      const books = entry.books || [];
      for (const book of books) {
        if (book.bookId) continue;
        if (!book.name) continue;
        book.bookId = await findOrCreateLibraryBook(book.name);
        changed = true;
        migratedBooks += 1;
      }
    }

    if (changed) {
      await Subject.collection.updateOne({ _id: raw._id }, { $set: { curriculum } });
      migratedSubjects += 1;
      console.log(`Migrated "${raw.name}" (${raw._id})`);
    }
  }

  console.log(`\nMigration complete. Updated ${migratedBooks} book entr${migratedBooks === 1 ? "y" : "ies"} across ${migratedSubjects} subject(s).`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
