const mongoose = require("mongoose");
const ExamPlan = require("../models/ExamPlan");
const ExamCycle = require("../models/ExamCycle");
const SectionResult = require("../models/SectionExamResult");
const Transfer = require("../models/StudentTransfer");
const SchoolClass = require("../models/SchoolClass");
const Subject = require("../models/Subject");
const Student = require("../models/Student");
const Teacher = require("../models/Teacher");
const User = require("../models/User");
const { ensure, same, validateStructures, validateMarks, nextGrade, gradeOrder } = require("../utils/examPolicy");
const { logAction } = require("../utils/auditLog");

async function transaction(action) {
  const session = await require('../tenancy/context').connection().startSession();
  try {
    let value;
    await session.withTransaction(async () => { value = await action(session); });
    return value;
  } finally { await session.endSession(); }
}
async function teacherFor(req) {
  const teacher = await Teacher.findOne({ userId: req.user.id, status: "active" });
  ensure(teacher, "Active teacher account required", 403);
  return teacher;
}
async function childFor(req) {
  const user = await User.findById(req.user.id);
  const childId = req.query.childId || user?.childStudentIds?.[0];
  ensure(user?.childStudentIds?.some(id => same(id, childId)), "Child is not linked to your account", 403);
  const child = await Student.findById(childId).populate("classId");
  ensure(child, "Student not found", 404);
  return child;
}
async function metadata(req, res) {
  let classes = await SchoolClass.find({ status: { $ne: "inactive" } }).sort({ grade: 1, section: 1 }).lean();
  let teacher;
  if (req.user.role === "teacher") {
    teacher = await teacherFor(req);
    classes = classes.filter(c => same(c.classTeacherId, teacher._id) || teacher.assignments.some(a => same(a.classId, c._id)));
  }
  const subjects = await Subject.find({ status: { $ne: "inactive" } })
    .select("name code classIds curriculum weeklyLectures status")
    .lean();
  res.json({ classes, subjects, teacherId: teacher?._id, assignments: teacher?.assignments || [], gradeOrder });
}
async function getPlans(req, res) {
  res.json({ items: await ExamPlan.find().sort({ academicYear: -1 }) });
}
async function savePlan(req, res) {
  const { academicYear, structures, revision } = req.body;
  ensure(typeof academicYear === "string" && /^\d{4}-\d{4}$/.test(academicYear) &&
    Number(academicYear.slice(5)) === Number(academicYear.slice(0, 4)) + 1, "Academic year must be consecutive years, e.g. 2026-2027");
  validateStructures(structures);
  const classes = await SchoolClass.find({ status: "active" }).select("grade");
  ensure(structures.every(s => (s.grades || []).every(g => classes.some(c => c.grade === g))), "Unknown class grade");
  const item = await transaction(async session => {
    let plan = await ExamPlan.findOne({ academicYear }).session(session);
    if (plan) {
      ensure(revision === plan.revision, "The structure changed. Refresh and try again", 409);
      ensure(!await ExamCycle.exists({ planId: plan._id }).session(session), "Structures are locked after a datesheet is saved", 409);
      plan.structures = structures;
      plan.revision += 1;
    } else { plan = new ExamPlan({ academicYear, structures }); }
    await plan.save({ session });
    return plan;
  });
  await logAction({
    req,
    entityType: "ExamPlan",
    entityId: item._id,
    action: "create",
    detail: { academicYear },
    note: `Configured exam plan for ${academicYear}`,
  });
  res.json(item);
}
async function getCycles(req, res) {
  let filter = {};
  if (req.query.planId) filter.planId = req.query.planId;
  let allowedGrades;
  if (req.user.role === "teacher") {
    const teacher = await teacherFor(req);
    const classes = await SchoolClass.find({ $or: [
      { _id: { $in: teacher.assignments.map(a => a.classId) } }, { classTeacherId: teacher._id },
    ] });
    allowedGrades = [...new Set(classes.map(c => c.grade))];
    filter.grades = { $in: allowedGrades };
  }
  if (req.user.role === "parent") {
    const child = await childFor(req);
    allowedGrades = [child.classId.grade];
    filter = { ...filter, datesheetLive: true, grades: child.classId.grade };
  }
  const items = await ExamCycle.find(filter).sort({ createdAt: -1 }).lean();
  for (const item of items) {
    if (allowedGrades) {
      item.grades = item.grades.filter(g => allowedGrades.includes(g));
      item.dates = item.dates.filter(d => allowedGrades.includes(d.grade));
    }
  }
  res.json({ items });
}
async function saveDatesheet(req, res) {
  const { planId, structureId, sessionId, dates, revision } = req.body;
  ensure(Array.isArray(dates) && dates.length > 0, "Add dates and subjects");
  const cycle = await transaction(async session => {
    // Writing the parent serializes plan edits against first datesheet creation.
    const plan = await ExamPlan.findOneAndUpdate({ _id: planId }, { $inc: { revision: 1 } }, { new: true, session });
    ensure(plan, "Exam structure not found", 404);
    const structure = plan.structures.id(structureId);
    const examSession = structure?.sessions.id(sessionId);
    ensure(examSession && structure.grades.length, "Select a session with assigned classes");
    let item = await ExamCycle.findOne({ planId, sessionId }).session(session);
    if (item) {
      ensure(revision === item.revision, "The datesheet changed. Refresh and try again", 409);
      ensure(!item.datesheetLive, "Live datesheets cannot be edited", 409);
      ensure(!await SectionResult.exists({ cycleId: item._id, "students.marks.0": { $exists: true } }).session(session),
        "Marks entry has started; datesheet cannot be changed", 409);
    }
    const classes = await SchoolClass.find({ grade: { $in: structure.grades }, status: { $ne: "inactive" } }).session(session);
    ensure(structure.grades.every(g => classes.some(c => c.grade === g)), "Every assigned grade needs an active section");
    const subjects = await Subject.find({ status: { $ne: "inactive" } }).session(session);
    const seen = new Set();
    const slots = new Set();
    const normalized = dates.map(d => {
      ensure(structure.grades.includes(d.grade), "Datesheet contains an unassigned class");
      const subject = subjects.find(s => same(s._id, d.subjectId));
      ensure(subject, "Subject not found");
      const isAssigned = classes.some(c => c.grade === d.grade && (
        subject.classIds.some(id => same(id, c._id)) ||
        subject.curriculum?.some(cu => cu.grade === c.grade) ||
        subject.weeklyLectures?.some(w => w.grade === c.grade) ||
        subject.classIds.length === 0
      ));
      ensure(isAssigned, "Subject is not assigned to this class");
      const start = new Date(d.startsAt), end = new Date(d.endsAt);
      ensure(Number.isFinite(+start) && Number.isFinite(+end) && end > start, "Exam end must be after its start");
      ensure(+end - +start <= 24 * 60 * 60 * 1000, "An exam cannot last longer than one day");
      const key = `${d.grade}:${subject._id}`;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(start);
      const slot = `${d.grade}:${day}`;
      ensure(!seen.has(key), "Schedule each subject only once per session");
      ensure(!slots.has(slot), "A class can have only one exam per day");
      seen.add(key); slots.add(slot);
      return { grade: d.grade, subjectId: subject._id, subject: subject.name, startsAt: start, endsAt: end };
    });
    for (const c of classes) {
      let required = subjects.filter(s => s.classIds.some(id => same(id, c._id)) || s.curriculum?.some(cu => cu.grade === c.grade) || s.weeklyLectures?.some(w => w.grade === c.grade));
      if (!required.length) {
        required = subjects.filter(s => normalized.some(d => d.grade === c.grade && same(d.subjectId, s._id)));
      }
      ensure(required.length, `Assign subjects to ${c.name} first`);
      ensure(required.every(s => seen.has(`${c.grade}:${s._id}`)), `Schedule all subjects for ${c.name}`);
    }
    const values = { planId, structureId, sessionId, academicYear: plan.academicYear,
      name: examSession.name, type: examSession.type, maxMarks: examSession.maxMarks,
      passMarks: examSession.passMarks, grades: structure.grades, dates: normalized };
    if (item) { Object.assign(item, values); item.revision += 1; }
    else item = new ExamCycle(values);
    await item.save({ session });
    await SectionResult.deleteMany({ cycleId: item._id }).session(session);
    for (const c of classes) {
      const roster = await Student.find({ classId: c._id, status: "active" }).sort({ name: 1 }).session(session);
      const scheduledForClass = normalized.filter(d => d.grade === c.grade);
      const classSubjects = subjects.filter(s =>
        s.classIds.some(id => same(id, c._id)) ||
        scheduledForClass.some(d => same(d.subjectId, s._id))
      );
      await SectionResult.create([{
        cycleId: item._id, classId: c._id, className: c.name, grade: c.grade, section: c.section,
        subjects: classSubjects.map(s => ({
          subjectId: s._id,
          name: s.name,
          endsAt: normalized.find(d => d.grade === c.grade && same(d.subjectId, s._id))?.endsAt || new Date(),
        })),
        students: roster.map(s => ({ studentId: s._id, name: s.name, admissionNo: s.admissionNo, marks: [] })),
      }], { session });
    }
    return item;
  });
  await logAction({
    req,
    entityType: "ExamCycle",
    entityId: cycle._id,
    action: "create",
    detail: { name: cycle.name, academicYear: cycle.academicYear },
    note: `Saved datesheet for ${cycle.name} (${cycle.academicYear})`,
  });
  res.json(cycle);
}
async function publishDatesheet(req, res) {
  const item = await ExamCycle.findOneAndUpdate({ _id: req.params.id, datesheetLive: false }, {
    $set: { datesheetLive: true, publishedBy: req.user.id, publishedAt: new Date() }, $inc: { revision: 1 },
  }, { new: true });
  ensure(item, "Datesheet not found or already live", 409);
  await logAction({
    req,
    entityType: "ExamCycle",
    entityId: item._id,
    action: "publish",
    detail: { name: item.name },
    note: `Published datesheet for ${item.name}`,
  });
  res.json(item);
}
async function getResults(req, res) {
  const filter = req.query.cycleId ? { cycleId: req.query.cycleId } : {};
  let teacher, child;
  if (req.user.role === "teacher") {
    teacher = await teacherFor(req);
    const classes = await SchoolClass.find({ classTeacherId: teacher._id });
    filter.classId = { $in: [...classes.map(c => c._id), ...teacher.assignments.map(a => a.classId)] };
  }
  if (req.user.role === "parent") {
    child = await childFor(req);
    filter.status = "live";
    filter["students.studentId"] = child._id;
  }
  const items = await SectionResult.find(filter).populate("cycleId", "name type academicYear maxMarks passMarks datesheetLive")
    .sort({ createdAt: -1 }).lean();
  const classTeachers = teacher ? await SchoolClass.find({ classTeacherId: teacher._id }).select("_id") : [];
  for (const item of items) {
    if (child) item.students = item.students.filter(s => same(s.studentId, child._id));
    if (teacher) {
      item.canApprove = classTeachers.some(c => same(c._id, item.classId));
      item.editableSubjectIds = teacher.assignments.filter(a => same(a.classId, item.classId))
        .flatMap(a => item.subjects.filter(s => s.name === a.subject).map(s => s.subjectId));
      if (!item.canApprove) {
        item.subjects = item.subjects.filter(s => item.editableSubjectIds.some(id => same(id, s.subjectId)));
        item.students = item.students.map(s => ({ ...s, marks: s.marks.filter(m => item.editableSubjectIds.some(id => same(id, m.subjectId))) }));
      }
    }
  }
  res.json({ items });
}
async function editResult(req, action) {
  return transaction(async session => {
    const result = await SectionResult.findById(req.params.id).session(session);
    ensure(result, "Result not found", 404);
    ensure(req.body.revision === result.revision, "Results changed. Refresh and try again", 409);
    const cycle = await ExamCycle.findOneAndUpdate({ _id: result.cycleId }, { $inc: { revision: 1 } }, { new: true, session });
    ensure(cycle, "Exam session not found", 404);
    await action(result, cycle, session);
    result.revision += 1;
    await result.save({ session });
    return result;
  });
}
async function saveMarks(req, res) {
  const teacher = await teacherFor(req);
  const result = await editResult(req, async (item, cycle) => {
    ensure(item.status === "draft", "Approved or submitted results cannot be edited", 409);
    const subject = item.subjects.find(s => same(s.subjectId, req.params.subjectId));
    ensure(subject && teacher.assignments.some(a => same(a.classId, item.classId) && a.subject === subject.name),
      "You can only enter marks for your assigned subjects", 403);
    ensure(!subject.submitted, "Subject already submitted; class teacher must return it first", 409);
    ensure(subject.endsAt <= new Date(), "Marks can only be entered after the exam ends", 409);
    validateMarks(req.body.results, item.students, cycle.maxMarks, req.body.submit === true);
    for (const row of req.body.results) {
      const student = item.students.find(s => same(s.studentId, row.studentId));
      const mark = { subjectId: subject.subjectId, marksObtained: row.marksObtained, grade: row.grade.trim(), remarks: row.remarks || "" };
      const index = student.marks.findIndex(m => same(m.subjectId, subject.subjectId));
      if (index < 0) student.marks.push(mark); else student.marks[index] = mark;
    }
    if (req.body.submit === true) {
      subject.submitted = true; subject.submittedAt = new Date(); subject.submittedBy = req.user.id;
    }
    if (item.subjects.every(s => s.submitted)) item.status = "submitted";
  });
  await logAction({
    req,
    entityType: "ExamMarks",
    entityId: result._id,
    action: req.body.submit === true ? "submit" : "update",
    detail: { resultId: result._id, status: result.status },
    note: `${req.body.submit === true ? "Submitted" : "Updated"} exam marks for class`,
  });
  res.json({ revision: result.revision, status: result.status });
}
async function approveResult(req, res) {
  const teacher = await teacherFor(req);
  const result = await editResult(req, async (item, cycle, session) => {
    const c = await SchoolClass.findById(item.classId).session(session);
    ensure(same(c?.classTeacherId, teacher._id), "Only the assigned class teacher can approve", 403);
    ensure(item.status === "submitted", "All subjects must be submitted before approval", 409);
    const decisions = req.body.decisions;
    ensure(Array.isArray(decisions) && decisions.length === item.students.length &&
      new Set(decisions.map(d => String(d.studentId))).size === item.students.length, "Set pass or fail for every student");
    for (const student of item.students) {
      const d = decisions.find(d => same(d.studentId, student.studentId));
      ensure(d && ["pass", "fail"].includes(d.decision), "Set pass or fail for every student");
      ensure(student.marks.length === item.subjects.length, "Every subject must have marks and a grade");
      ensure(d.decision !== "pass" || student.marks.every(m => m.marksObtained >= cycle.passMarks),
        `${student.name} has marks below the minimum pass mark`);
      student.decision = d.decision; student.remark = d.remark || "";
    }
    item.status = "approved"; item.approvedBy = req.user.id; item.approvedAt = new Date();
  });
  await logAction({
    req,
    entityType: "ExamMarks",
    entityId: result._id,
    action: "approve",
    detail: { resultId: result._id, status: result.status },
    note: "Approved class exam results",
  });
  res.json({ revision: result.revision, status: result.status });
}
async function returnResult(req, res) {
  const teacher = req.user.role === "teacher" ? await teacherFor(req) : null;
  const result = await editResult(req, async (item, cycle, session) => {
    ensure(item.status !== "live", "Live results cannot be returned", 409);
    if (teacher) {
      const c = await SchoolClass.findById(item.classId).session(session);
      ensure(same(c?.classTeacherId, teacher._id), "Only the class teacher can return marks", 403);
    }
    item.status = "draft"; item.approvedBy = undefined; item.approvedAt = undefined;
    item.subjects.forEach(s => { s.submitted = false; s.submittedAt = undefined; s.submittedBy = undefined; });
    item.students.forEach(s => { s.decision = undefined; s.remark = undefined; });
  });
  res.json({ revision: result.revision, status: result.status });
}
async function publishResults(req, res) {
  const ids = req.body.ids;
  ensure(Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && new Set(ids).size === ids.length,
    "Select between 1 and 200 unique sections");
  await transaction(async session => {
    const results = await SectionResult.find({ _id: { $in: ids } }).session(session);
    ensure(results.length === ids.length && results.every(r => r.status === "approved"), "Every selected section must be approved", 409);
    for (const item of results) {
      const cycle = await ExamCycle.findOneAndUpdate({ _id: item.cycleId }, { $inc: { revision: 1 } }, { new: true, session });
      ensure(cycle?.datesheetLive, "Publish the datesheet before publishing results", 409);
      item.status = "live"; item.publishedAt = new Date(); item.publishedBy = req.user.id; item.revision += 1;
      await item.save({ session });
      if (cycle.type === "final") {
        const activeClasses = await SchoolClass.find({ status: "active" }).session(session);
        const index = gradeOrder.indexOf(item.grade);
        ensure(index >= 0, "Class grade has no promotion order; configure a standard grade before final publication");
        const isLast = !activeClasses.some(c => gradeOrder.indexOf(c.grade) > index);
        if (isLast) {
          for (const student of item.students) {
            const current = await Student.findById(student.studentId).session(session);
            if (!current || current.status !== "active" || !same(current.classId, item.classId)) continue;
            await Transfer.updateOne({ studentId: student.studentId, status: "in_process" }, { $setOnInsert: {
              classId: item.classId, resultId: item._id, type: "pass_out", remark: "Pass-out", initiatedBy: req.user.id,
            } }, { upsert: true, session });
          }
          item.promotion = { completed: true, passOut: true, completedAt: new Date(), completedBy: req.user.id };
          await item.save({ session });
        }
      }
    }
  });
  await logAction({
    req,
    entityType: "ExamMarks",
    entityId: ids[0],
    action: "publish",
    detail: { sectionCount: ids.length },
    note: `Published exam results for ${ids.length} sections`,
  });
  res.json({ message: "Results are live", count: ids.length });
}
async function promote(req, res) {
  const result = await editResult(req, async (item, cycle, session) => {
    ensure(cycle.type === "final" && item.status === "live", "Only live final results can be promoted", 409);
    ensure(!item.promotion?.completed, "This section has already been processed", 409);
    const target = await SchoolClass.findOne({ _id: req.body.targetClassId, status: "active" }).session(session);
    ensure(target && target.grade === nextGrade(item.grade), "Select a section in the next class");
    const movedStudentIds = [], skippedStudentIds = [];
    for (const student of item.students.filter(s => s.decision === "pass")) {
      const current = await Student.findById(student.studentId).session(session);
      ensure(current, `${student.name} no longer exists`, 409);
      if (current.status === "inactive" || await Transfer.exists({ studentId: student.studentId, status: "in_process" }).session(session)) {
        skippedStudentIds.push(student.studentId);
        continue;
      }
      const updated = await Student.updateOne({ _id: student.studentId, classId: item.classId, status: "active" },
        { $set: { classId: target._id }, $unset: { rollNo: 1 } }, { session });
      ensure(updated.matchedCount === 1, `${student.name} has already moved or is inactive`, 409);
      movedStudentIds.push(student.studentId);
    }
    for (const classId of [item.classId, target._id]) {
      const count = await Student.countDocuments({ classId, status: "active" }).session(session);
      await SchoolClass.updateOne({ _id: classId }, { $set: { studentCount: count } }, { session });
    }
    item.promotion = { completed: true, targetClassId: target._id, movedStudentIds, skippedStudentIds,
      completedAt: new Date(), completedBy: req.user.id };
  });
  await logAction({
    req,
    entityType: "ClassPromotion",
    entityId: req.body.targetClassId,
    action: "promote",
    detail: { targetClassId: req.body.targetClassId },
    note: "Promoted passing students to next class",
  });
  res.json({ message: "Passing students promoted", revision: result.revision });
}
async function listTransfers(req, res) {
  const filter = {};
  if (req.query.status) { ensure(["in_process", "transferred"].includes(req.query.status), "Invalid transfer status"); filter.status = req.query.status; }
  if (req.query.type) { ensure(["pass_out", "manual"].includes(req.query.type), "Invalid transfer type"); filter.type = req.query.type; }
  const page = Math.max(1, Number.parseInt(req.query.page) || 1);
  const limit = 50;
  const [items, total] = await Promise.all([
    Transfer.find(filter).populate("studentId", "name admissionNo").populate("classId", "name")
      .populate("initiatedBy", "name").populate("completedBy", "name").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Transfer.countDocuments(filter),
  ]);
  res.json({ items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
}
async function initiateTransfer(req, res) {
  ensure(req.body.studentId && mongoose.Types.ObjectId.isValid(req.body.studentId), "Valid student ID is required", 400);
  ensure(typeof req.body.remark === "string" && req.body.remark.trim(), "A transfer remark is required", 400);
  const item = await transaction(async session => {
    const student = await Student.findOneAndUpdate({ _id: req.body.studentId, status: "active" },
      { $inc: { __v: 1 } }, { new: true, session });
    ensure(student, "Active student not found", 404);
    const [transfer] = await Transfer.create([{ studentId: student._id, classId: student.classId,
      type: "manual", remark: req.body.remark.trim(), initiatedBy: req.user.id }], { session });
    return transfer;
  });
  await logAction({
    req,
    entityType: "Transfer",
    entityId: item._id,
    action: "create",
    detail: { studentId: req.body.studentId, remark: req.body.remark },
    note: `Initiated transfer: ${req.body.remark}`,
  });
  res.status(201).json(item);
}
async function completeTransfer(req, res) {
  await transaction(async session => {
    const item = await Transfer.findOne({ _id: req.params.id, status: "in_process" }).session(session);
    ensure(item, "Transfer not found or already completed", 409);
    const student = await Student.findById(item.studentId).session(session);
    ensure(student && same(student.classId, item.classId), "Student class changed; review the transfer", 409);
    student.status = "inactive"; await student.save({ session });
    item.status = "transferred"; item.completedAt = new Date(); item.completedBy = req.user.id;
    await item.save({ session });
    const count = await Student.countDocuments({ classId: item.classId, status: "active" }).session(session);
    await SchoolClass.updateOne({ _id: item.classId }, { $set: { studentCount: count } }, { session });
  });
  await logAction({
    req,
    entityType: "Transfer",
    entityId: req.params.id,
    action: "update",
    note: "Completed transfer and relieved student",
  });
  res.json({ message: "Student transferred" });
}
module.exports = { metadata, getPlans, savePlan, getCycles, saveDatesheet, publishDatesheet, getResults,
  saveMarks, approveResult, returnResult, publishResults, promote, listTransfers, initiateTransfer, completeTransfer };
