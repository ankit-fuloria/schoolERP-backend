const Subject = require("../models/Subject");
const SchoolClass = require("../models/SchoolClass");
const LibraryBook = require("../models/LibraryBook");
const { logAction } = require("../utils/auditLog");

function normalizeChapters(chapters) {
  return Array.isArray(chapters)
    ? chapters
        .map((chapter) => ({
          name: String(chapter.name || "").trim(),
          description: String(chapter.description || "").trim() || undefined,
          topics: Array.isArray(chapter.topics)
            ? chapter.topics.map((topic) => String(topic).trim()).filter(Boolean)
            : [],
          term: chapter.term === "term2" ? "term2" : "term1",
        }))
        .filter((chapter) => chapter.name)
    : [];
}

// Books are never created here — each entry only references a book that
// already exists in the Library, so every bookId is checked against it and
// the title is always re-derived from there (never trusted from the client).
async function normalizeBooks(books) {
  if (!Array.isArray(books)) return [];
  const bookIds = [...new Set(books.map((b) => String(b.bookId || "")).filter(Boolean))];
  if (!bookIds.length) return [];

  const libraryBooks = await LibraryBook.find({ _id: { $in: bookIds } });
  const byId = new Map(libraryBooks.map((b) => [b._id.toString(), b]));

  const missing = bookIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error("One or more mapped books no longer exist in the library");
  }

  return books
    .filter((book) => book.bookId)
    .map((book) => {
      const libraryBook = byId.get(String(book.bookId));
      return {
        bookId: libraryBook._id,
        name: libraryBook.title,
        chapters: normalizeChapters(book.chapters),
      };
    });
}

async function normalizeCurriculum(curriculum) {
  if (!Array.isArray(curriculum)) return [];
  const entries = await Promise.all(
    curriculum.map(async (entry) => ({
      grade: String(entry.grade || "").trim(),
      books: await normalizeBooks(entry.books),
    }))
  );
  return entries.filter((entry) => entry.grade);
}

function serializeSubject(subject) {
  return {
    id: subject._id,
    name: subject.name,
    code: subject.code,
    description: subject.description,
    status: subject.status,
    classes: (subject.classIds || []).map((schoolClass) => ({
      id: (schoolClass._id || schoolClass).toString(),
      name: schoolClass.name || "",
    })),
    curriculum: (subject.curriculum || []).map((gradeCurriculum) => ({
      grade: gradeCurriculum.grade,
      books: (gradeCurriculum.books || []).map((book) => ({
        bookId: book.bookId ? book.bookId.toString() : null,
        name: book.name,
        chapters: (book.chapters || []).map((chapter) => ({
          name: chapter.name,
          description: chapter.description || null,
          topics: (chapter.topics || []).map(String),
          term: chapter.term,
        })),
      })),
    })),
  };
}

async function validateClassIds(classIds) {
  const ids = Array.isArray(classIds) ? [...new Set(classIds.map(String))] : [];
  if (!ids.length) return ids;
  const count = await SchoolClass.countDocuments({ _id: { $in: ids } });
  if (count !== ids.length) throw new Error("One or more selected classes do not exist");
  return ids;
}

async function list(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 10));
  const filter = {};
  if (req.query.search) {
    filter.$or = [
      { name: { $regex: req.query.search, $options: "i" } },
      { code: { $regex: req.query.search, $options: "i" } },
    ];
  }
  if (req.query.includeInactive !== "true") filter.status = { $ne: "inactive" };

  const [items, total] = await Promise.all([
    Subject.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("classIds", "name"),
    Subject.countDocuments(filter),
  ]);
  res.json({
    items: items.map(serializeSubject),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

async function create(req, res) {
  if (!req.body.name?.trim()) return res.status(400).json({ message: "Subject name is required" });
  let classIds;
  let curriculum;
  try {
    classIds = await validateClassIds(req.body.classIds);
    curriculum = await normalizeCurriculum(req.body.curriculum);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const subject = await Subject.create({
    name: req.body.name.trim(),
    code: req.body.code?.trim(),
    description: req.body.description?.trim(),
    classIds,
    curriculum,
  });
  await subject.populate("classIds", "name");
  await logAction({
    req,
    entityType: "Subject",
    entityId: subject._id,
    action: "create",
    detail: { name: subject.name, code: subject.code },
    note: `Created subject ${subject.name}`,
  });
  res.status(201).json(serializeSubject(subject));
}

async function update(req, res) {
  const subject = await Subject.findById(req.params.id);
  if (!subject) return res.status(404).json({ message: "Subject not found" });
  let classIds;
  let curriculum;
  try {
    classIds = "classIds" in req.body ? await validateClassIds(req.body.classIds) : undefined;
    curriculum =
      req.body.curriculum !== undefined ? await normalizeCurriculum(req.body.curriculum) : undefined;
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  if (req.body.name !== undefined) subject.name = req.body.name.trim();
  if (req.body.code !== undefined) subject.code = req.body.code?.trim();
  if (req.body.description !== undefined) subject.description = req.body.description?.trim();
  if (classIds !== undefined) subject.classIds = classIds;
  if (curriculum !== undefined) subject.curriculum = curriculum;
  if (req.body.status !== undefined) subject.status = req.body.status;
  await subject.save();
  await subject.populate("classIds", "name");
  await logAction({
    req,
    entityType: "Subject",
    entityId: subject._id,
    action: "update",
    detail: req.body,
    note: `Updated subject ${subject.name}`,
  });
  res.json(serializeSubject(subject));
}

async function disable(req, res) {
  const subject = await Subject.findByIdAndUpdate(
    req.params.id,
    { status: "inactive" },
    { new: true }
  ).populate("classIds", "name");
  if (!subject) return res.status(404).json({ message: "Subject not found" });
  await logAction({
    req,
    entityType: "Subject",
    entityId: subject._id,
    action: "disable",
    note: `Disabled subject ${subject.name}`,
  });
  res.json(serializeSubject(subject));
}

module.exports = { list, create, update, disable };
