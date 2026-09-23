const SchoolClass = require("../models/SchoolClass");
const Subject = require("../models/Subject");
const Teacher = require("../models/Teacher");
const { gradeBandFor } = require("../utils/gradeBands");
const { logAction } = require("../utils/auditLog");

function serializeClass(c) {
  return {
    id: c._id,
    name: c.name,
    grade: c.grade,
    section: c.section,
    roomNo: c.roomNo || "",
    classTeacher: c.classTeacherId
      ? { id: c.classTeacherId._id, name: c.classTeacherId.name }
      : null,
    gradeBand: c.gradeBand,
    studentCount: c.studentCount,
    status: c.status,
  };
}

async function listClasses(req, res) {
  const filter = {};
  if (!req.query.includeInactive) {
    filter.status = { $ne: "inactive" };
  }
  const classes = await SchoolClass.find(filter)
    .sort({ grade: 1, section: 1 })
    .populate("classTeacherId", "name");
  res.json({
    classes: classes.map(serializeClass),
  });
}

async function createClass(req, res) {
  const { grade, section, roomNo, subjectIds, classTeacherId } = req.body;
  if (!grade || !section) {
    return res.status(400).json({ message: "grade and section are required" });
  }

  const name = `${grade}-${section}`;
  const existing = await SchoolClass.findOne({ name });
  if (existing) {
    return res.status(400).json({ message: "A class with this grade and section already exists" });
  }

  const validSubjectIds = Array.isArray(subjectIds) ? [...new Set(subjectIds.map(String))] : [];
  if (validSubjectIds.length) {
    const count = await Subject.countDocuments({ _id: { $in: validSubjectIds } });
    if (count !== validSubjectIds.length) {
      return res.status(400).json({ message: "One or more selected subjects do not exist" });
    }
  }
  if (classTeacherId) {
    const teacher = await Teacher.findOne({ _id: classTeacherId, status: { $ne: "inactive" } });
    if (!teacher) return res.status(400).json({ message: "Selected class teacher does not exist" });
  }

  const schoolClass = await SchoolClass.create({
    name,
    grade,
    section,
    roomNo: roomNo ? String(roomNo).trim() : "",
    gradeBand: gradeBandFor(grade),
    studentCount: 0,
    classTeacherId,
  });
  if (validSubjectIds.length) {
    await Subject.updateMany(
      { _id: { $in: validSubjectIds } },
      { $addToSet: { classIds: schoolClass._id } }
    );
  }

  await schoolClass.populate("classTeacherId", "name");
  await logAction({
    req,
    entityType: "Class",
    entityId: schoolClass._id,
    action: "create",
    detail: { name: schoolClass.name, grade: schoolClass.grade, section: schoolClass.section },
    note: `Created class ${schoolClass.name}`,
  });
  res.status(201).json(serializeClass(schoolClass));
}

// "Delete" only disables the class (status: inactive). Students already
// enrolled keep their classId reference; the class just stops appearing in
// dropdowns for new assignments.
async function disableClass(req, res) {
  const schoolClass = await SchoolClass.findByIdAndUpdate(
    req.params.id,
    { status: "inactive" },
    { new: true }
  ).populate("classTeacherId", "name");
  if (!schoolClass) {
    return res.status(404).json({ message: "Class not found" });
  }
  await logAction({
    req,
    entityType: "Class",
    entityId: schoolClass._id,
    action: "disable",
    note: `Disabled class ${schoolClass.name}`,
  });
  res.json(serializeClass(schoolClass));
}

async function updateClass(req, res) {
  const currentClass = await SchoolClass.findById(req.params.id);
  if (!currentClass) {
    return res.status(404).json({ message: "Class not found" });
  }
  if (req.body.classTeacherId) {
    const teacher = await Teacher.findOne({ _id: req.body.classTeacherId, status: { $ne: "inactive" } });
    if (!teacher) return res.status(400).json({ message: "Selected class teacher does not exist" });
  }
  if (Array.isArray(req.body.subjectIds)) {
    const subjectIds = [...new Set(req.body.subjectIds.map(String))];
    const count = await Subject.countDocuments({ _id: { $in: subjectIds } });
    if (count !== subjectIds.length) {
      return res.status(400).json({ message: "One or more selected subjects do not exist" });
    }
    await Subject.updateMany({ classIds: req.params.id }, { $pull: { classIds: req.params.id } });
    if (subjectIds.length) {
      await Subject.updateMany(
        { _id: { $in: subjectIds } },
        { $addToSet: { classIds: req.params.id } }
      );
    }
  }
  const body = { ...req.body };
  delete body.subjectIds;
  if (body.section !== undefined || body.grade !== undefined) {
    const grade = body.grade || currentClass.grade;
    const section = body.section || currentClass.section;
    const existing = await SchoolClass.findOne({
      _id: { $ne: req.params.id },
      grade,
      section,
    });
    if (existing) return res.status(400).json({ message: "A class with this grade and section already exists" });
    body.name = `${grade}-${section}`;
    body.gradeBand = gradeBandFor(grade);
  }
  const schoolClass = await SchoolClass.findByIdAndUpdate(req.params.id, body, {
    new: true,
  }).populate("classTeacherId", "name");
  await logAction({
    req,
    entityType: "Class",
    entityId: schoolClass._id,
    action: "update",
    detail: body,
    note: `Updated class ${schoolClass.name}`,
  });
  res.json(serializeClass(schoolClass));
}

module.exports = { listClasses, createClass, disableClass, updateClass };
