const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../src/models/User");
const Teacher = require("../src/models/Teacher");
const Staff = require("../src/models/Staff");
const SchoolClass = require("../src/models/SchoolClass");
const Subject = require("../src/models/Subject");
const Student = require("../src/models/Student");
const Plan = require("../src/models/ExamPlan");
const Cycle = require("../src/models/ExamCycle");
const Result = require("../src/models/SectionExamResult");
const Transfer = require("../src/models/StudentTransfer");
const { validateStructures, validateMarks } = require("../src/utils/examPolicy");
let mongo, app, tokens, users, teachers, classes, subjects, students, plan, cycle;
const oid = value => value._id.toString();
function api(role, method, path, body) {
  const call = request(app)[method](path).set("Authorization", `Bearer ${tokens[role]}`);
  return body === undefined ? call : call.send(body);
}
function structures() {
  const sessions = () => [
    { name: "Final", type: "final", maxMarks: 100, passMarks: 33 },
    { name: "Mid 1", type: "mid", maxMarks: 50, passMarks: 20 },
    { name: "Mid 2", type: "mid", maxMarks: 50, passMarks: 20 },
    { name: "Sessional 1", type: "sessional", maxMarks: 20, passMarks: 8 },
    { name: "Sessional 2", type: "sessional", maxMarks: 20, passMarks: 8 },
  ];
  return [{ name: "Primary", grades: ["1st", "2nd"], sessions: sessions() },
    { name: "Leaving class", grades: ["8th"], sessions: sessions() }];
}
async function makeCycle(structureIndex = 0, sessionIndex = 0, future = false) {
  const structure = plan.structures[structureIndex];
  const startsAt = new Date(Date.now() + (future ? 5 : -5) * 86400000);
  const dates = structure.grades.flatMap(grade => subjects.filter(subject => classes.some(c =>
    c.grade === grade && subject.classIds.some(id => id.toString() === oid(c)))).map((s, i) => ({
    grade, subjectId: oid(s), startsAt: new Date(+startsAt + i * 86400000).toISOString(),
    endsAt: new Date(+startsAt + i * 86400000 + 3600000).toISOString(),
  })));
  const response = await api("principal", "put", "/api/exam-workflow/cycles", {
    planId: plan._id, structureId: structure._id, sessionId: structure.sessions[sessionIndex]._id, dates,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}
async function reports(cycleId) { return Result.find({ cycleId }).sort({ className: 1 }).lean(); }
async function gradeAll(cycleId) {
  for (const item of await reports(cycleId)) {
    let revision = item.revision;
    for (const subject of item.subjects) {
      const response = await api(subject.name === "Math" ? "math" : "art", "put",
        `/api/exam-workflow/results/${item._id}/subjects/${subject.subjectId}`, {
          revision, submit: true, results: item.students.map((s, i) => ({
            studentId: s.studentId, marksObtained: i === 0 ? 80 : 20, grade: i === 0 ? "A" : "F",
          })),
        });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      revision = response.body.revision;
    }
    await api("math", "post", `/api/exam-workflow/results/${item._id}/approve`, { revision, decisions: [] }).expect(403);
    if (item.students.length > 1) {
      await api("classTeacher", "post", `/api/exam-workflow/results/${item._id}/approve`, {
        revision, decisions: item.students.map(s => ({ studentId: s.studentId, decision: "pass" })),
      }).expect(400);
    }
    const response = await api("classTeacher", "post", `/api/exam-workflow/results/${item._id}/approve`, {
      revision, decisions: item.students.map((s, i) => ({ studentId: s.studentId, decision: i === 0 ? "pass" : "fail" })),
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
}
before(async () => {
  process.env.JWT_SECRET = "isolated-exam-test-secret";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.14" } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([Plan.init(), Cycle.init(), Result.init(), Transfer.init()]);
  app = express(); app.use(express.json());
  app.use("/api/exam-workflow", require("../src/routes/examWorkflowRoutes"));
  app.use("/api/transfers", require("../src/routes/transferRoutes"));
  app.use("/api/parent", require("../src/routes/parentPortalRoutes"));
  app.use("/api/teacher", require("../src/routes/teacherPortalRoutes"));
  app.use((err, req, res, next) => res.status(err.status || (err.code === 11000 ? 400 : 500)).json({ message: err.message }));
  users = {}; tokens = {}; teachers = {};
  for (const [key, role] of Object.entries({ principal: "principal", staff: "staff", restricted: "staff", math: "teacher", art: "teacher", classTeacher: "teacher", parent: "parent" })) {
    users[key] = await User.create({ name: key, email: `${key}@test.invalid`, passwordHash: "unused", role });
    tokens[key] = jwt.sign({ id: oid(users[key]), role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    if (role === "teacher") teachers[key] = await Teacher.create({ name: key, firstName: key, phone: key, subject: key, userId: users[key]._id });
    if (role === "staff") await Staff.create({ name: key, firstName: key, phone: key, department: "Office", userId: users[key]._id,
      permissions: key === "staff" ? ["students", "examinations"] : [] });
  }
  classes = await SchoolClass.create([
    { grade: "1st", section: "A" }, { grade: "1st", section: "B" }, { grade: "2nd", section: "A" }, { grade: "8th", section: "A" },
  ].map(c => ({ ...c, name: `${c.grade}-${c.section}`, gradeBand: "Primary", classTeacherId: teachers.classTeacher._id })));
  subjects = await Subject.create([{ name: "Math", classIds: classes.map(c => c._id) }, { name: "Art", classIds: classes.slice(0, 2).map(c => c._id) }]);
  for (const [key, subject] of [["math", subjects[0]], ["art", subjects[1]]]) {
    teachers[key].assignments = subject.classIds.map(classId => ({ classId, subject: subject.name })); await teachers[key].save();
  }
  students = [];
  for (const c of classes) for (let i = 0; i < 2; i++) {
    students.push(await Student.create({ name: `${c.name} student ${i}`, admissionNo: `${c.name}-${i}`, classId: c._id }));
  }
  users.parent.childStudentIds = [students[0]._id, students[2]._id]; await users.parent.save();
});
after(async () => {
  if (process.env.EXAM_UI_FIXTURE_PATH && app) {
    const fixture = { tokens, children: students.slice(0, 4).filter((_, i) => i % 2 === 0).map(s => ({
      id: oid(s), name: s.name, admissionNo: s.admissionNo, className: s.name.split(' student')[0], classId: s.classId,
    })), responses: {} };
    for (const role of Object.keys(tokens)) {
      fixture.responses[role] = {};
      for (const path of ['/api/exam-workflow/metadata', '/api/exam-workflow/plans', '/api/exam-workflow/cycles', '/api/exam-workflow/results',
        '/api/transfers?status=in_process&type=pass_out&page=1', '/api/transfers?status=in_process&type=manual&page=1']) {
        const response = await api(role, 'get', path); fixture.responses[role][path] = { status: response.status, body: response.body };
      }
      if (role === 'parent') for (const child of fixture.children) for (const path of ['cycles', 'results']) {
        const url = `/api/exam-workflow/${path}?childId=${child.id}`;
        const response = await api(role, 'get', url); fixture.responses[role][url] = { status: response.status, body: response.body };
      }
    }
    require('node:fs').writeFileSync(process.env.EXAM_UI_FIXTURE_PATH, JSON.stringify(fixture));
  }
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});

test("structure invariants: one final, many mid/sessional, exclusive classes and valid thresholds", async () => {
  validateStructures(structures());
  const duplicateGrade = structures(); duplicateGrade[1].grades.push("1st");
  assert.throws(() => validateStructures(duplicateGrade), /only one structure/);
  const duplicateFinal = structures(); duplicateFinal[0].sessions.push({ ...duplicateFinal[0].sessions[0], name: "Another final" });
  assert.throws(() => validateStructures(duplicateFinal), /exactly one final/);
  const badMarks = structures(); badMarks[0].sessions[0].passMarks = 101;
  assert.throws(() => validateStructures(badMarks), /Pass marks/);
  await api("parent", "put", "/api/exam-workflow/plans", {}).expect(403);
  await api("restricted", "get", "/api/exam-workflow/plans").expect(403);
  const response = await api("principal", "put", "/api/exam-workflow/plans", { academicYear: "2026-2027", structures: structures() });
  assert.equal(response.status, 200, JSON.stringify(response.body)); plan = response.body;
  await api("principal", "put", "/api/exam-workflow/plans", { academicYear: "2026-2027", structures: structures(), revision: 99 }).expect(409);
});
test("saved datesheets are scoped to teachers, hidden from parents until principal publication", async () => {
  cycle = await makeCycle();
  const saved = await api("parent", "get", `/api/exam-workflow/cycles?childId=${oid(students[0])}`);
  assert.equal(saved.body.items.length, 0);
  const teacher = await api("art", "get", "/api/exam-workflow/cycles");
  assert.deepEqual(teacher.body.items[0].grades, ["1st"]);
  assert(teacher.body.items[0].dates.every(d => d.grade === "1st"));
  await api("staff", "post", `/api/exam-workflow/cycles/${cycle._id}/publish`, {}).expect(403);
  await api("principal", "post", `/api/exam-workflow/cycles/${cycle._id}/publish`, {}).expect(200);
  const visible = await api("parent", "get", `/api/exam-workflow/cycles?childId=${oid(students[0])}`);
  assert.equal(visible.body.items.length, 1); assert.deepEqual(visible.body.items[0].grades, ["1st"]);
  await api("parent", "get", `/api/exam-workflow/cycles?childId=${oid(students[1])}`).expect(403);
  const latestPlan = await Plan.findById(plan._id);
  await api("principal", "put", "/api/exam-workflow/plans", { academicYear: "2026-2027", structures: structures(), revision: latestPlan.revision }).expect(409);
});
test("marks require assigned subject, completed exam, valid roster, range, grade and complete submission", async () => {
  const [result] = await reports(cycle._id);
  const math = result.subjects.find(s => s.name === "Math");
  const path = `/api/exam-workflow/results/${result._id}/subjects/${math.subjectId}`;
  const payload = { revision: 0, submit: true, results: result.students.map(s => ({ studentId: s.studentId, marksObtained: 90, grade: "A" })) };
  await api("art", "put", path, payload).expect(403);
  await api("parent", "put", path, payload).expect(403);
  await api("math", "put", path, { ...payload, results: payload.results.slice(0, 1) }).expect(400);
  await api("math", "put", path, { ...payload, results: payload.results.map(r => ({ ...r, marksObtained: null })) }).expect(400);
  await api("math", "put", path, { ...payload, results: payload.results.map(r => ({ ...r, grade: "" })) }).expect(400);
  assert.throws(() => validateMarks([{ studentId: result.students[0].studentId, marksObtained: 101, grade: "A" }], result.students, 100), /between/);
  const future = await makeCycle(0, 1, true);
  const [futureResult] = await reports(future._id);
  await api("math", "put", `/api/exam-workflow/results/${futureResult._id}/subjects/${math.subjectId}`, {
    revision: 0, results: futureResult.students.map(s => ({ studentId: s.studentId, marksObtained: 20, grade: "B" })),
  }).expect(409);
  await api("classTeacher", "post", `/api/exam-workflow/results/${result._id}/approve`, { revision: 0, decisions: [] }).expect(409);
});
test("class teacher approval, principal bulk publication and parent isolation", async () => {
  const before = await reports(cycle._id);
  await api("principal", "post", "/api/exam-workflow/results/publish", { ids: before.map(oid) }).expect(409);
  await gradeAll(cycle._id);
  const graded = await reports(cycle._id);
  const parentDraft = await api("parent", "get", "/api/exam-workflow/results"); assert.equal(parentDraft.body.items.length, 0);
  await api("math", "post", "/api/exam-workflow/results/publish", { ids: graded.map(oid) }).expect(403);
  await api("staff", "post", "/api/exam-workflow/results/publish", { ids: graded.map(oid) }).expect(403);
  await api("principal", "post", "/api/exam-workflow/results/publish", { ids: graded.map(oid) }).expect(200);
  await api("principal", "post", "/api/exam-workflow/results/publish", { ids: graded.map(oid) }).expect(409);
  const parent = await api("parent", "get", `/api/exam-workflow/results?childId=${oid(students[0])}`);
  assert.equal(parent.body.items.length, 1); assert.equal(parent.body.items[0].students.length, 1);
  assert.equal(parent.body.items[0].students[0].studentId, oid(students[0]));
  const sibling = await api("parent", "get", `/api/exam-workflow/results?childId=${oid(students[2])}`);
  assert.equal(sibling.body.items[0].students[0].studentId, oid(students[2]));
  const [live] = await reports(cycle._id);
  await api("classTeacher", "post", `/api/exam-workflow/results/${live._id}/return`, { revision: live.revision }).expect(409);
});
test("promotion moves only passing students once and preserves published history", async () => {
  const [item] = await reports(cycle._id);
  await api("principal", "post", `/api/exam-workflow/results/${item._id}/promote`, { revision: item.revision, targetClassId: oid(classes[3]) }).expect(400);
  await api("staff", "post", `/api/exam-workflow/results/${item._id}/promote`, { revision: item.revision, targetClassId: oid(classes[2]) }).expect(403);
  await api("principal", "post", `/api/exam-workflow/results/${item._id}/promote`, { revision: item.revision, targetClassId: oid(classes[2]) }).expect(200);
  assert.equal((await Student.findById(students[0]._id)).classId.toString(), oid(classes[2]));
  assert.equal((await Student.findById(students[1]._id)).classId.toString(), oid(classes[0]));
  const parent = await api("parent", "get", "/api/exam-workflow/results");
  assert.equal(parent.body.items[0].className, "1st-A");
  const latest = await Result.findById(item._id);
  await api("principal", "post", `/api/exam-workflow/results/${item._id}/promote`, { revision: latest.revision, targetClassId: oid(classes[2]) }).expect(409);
  assert.equal((await SchoolClass.findById(classes[0]._id)).studentCount, 1);
  assert.equal((await SchoolClass.findById(classes[2]._id)).studentCount, 3);
});
test("last class automatically enters pass-out transfer queue; only principal can complete", async () => {
  const final = await makeCycle(1);
  await gradeAll(final._id);
  await api("principal", "post", `/api/exam-workflow/cycles/${final._id}/publish`, {}).expect(200);
  const graded = await reports(final._id);
  await api("principal", "post", "/api/exam-workflow/results/publish", { ids: graded.map(oid) }).expect(200);
  const transfers = await Transfer.find({ type: "pass_out" }); assert.equal(transfers.length, 2);
  await api("staff", "post", `/api/transfers/${transfers[0]._id}/complete`, {}).expect(403);
  await api("principal", "post", `/api/transfers/${transfers[0]._id}/complete`, {}).expect(200);
  assert.equal((await Student.findById(transfers[0].studentId)).status, "inactive");
  assert.equal((await Transfer.findById(transfers[0]._id)).status, "transferred");
  await api("principal", "post", `/api/transfers/${transfers[0]._id}/complete`, {}).expect(409);
});
test("concurrent subject edits reject stale revisions and class teacher can return submissions", async () => {
  const mid = await makeCycle(0, 2);
  const [item] = await reports(mid._id);
  const math = item.subjects.find(s => s.name === "Math");
  const path = `/api/exam-workflow/results/${item._id}/subjects/${math.subjectId}`;
  const payload = { revision: 0, results: item.students.map(s => ({ studentId: s.studentId, marksObtained: 40, grade: "A" })) };
  const responses = await Promise.all([api("math", "put", path, payload), api("math", "put", path, payload)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const latest = await Result.findById(item._id);
  await api("math", "put", path, { ...payload, revision: latest.revision, submit: true }).expect(200);
  const submitted = await Result.findById(item._id);
  await api("math", "post", `/api/exam-workflow/results/${item._id}/return`, { revision: submitted.revision }).expect(403);
  await api("classTeacher", "post", `/api/exam-workflow/results/${item._id}/return`, { revision: submitted.revision }).expect(200);
  const returned = await Result.findById(item._id);
  assert.equal(returned.status, "draft"); assert(returned.subjects.every(s => !s.submitted));
  assert.equal(returned.students[0].marks[0].marksObtained, 40);
});
test("staff requests retain remarks, reject duplicates, and cannot override transfer status", async () => {
  await api("restricted", "post", "/api/transfers", { studentId: oid(students[1]), remark: "Moving" }).expect(403);
  await api("staff", "post", "/api/transfers", { studentId: oid(students[1]), remark: "" }).expect(400);
  const response = await api("staff", "post", "/api/transfers", {
    studentId: oid(students[1]), remark: "Moving to another city", status: "transferred", type: "pass_out",
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.status, "in_process"); assert.equal(response.body.type, "manual");
  assert.equal(response.body.remark, "Moving to another city");
  await api("staff", "post", "/api/transfers", { studentId: oid(students[1]), remark: "Again" }).expect(400);
  const list = await api("staff", "get", "/api/transfers?type=manual&status=in_process");
  assert.equal(list.body.items.length, 1); assert.equal(list.body.items[0].initiatedBy._id, oid(users.staff));
});
test("promotion leaves transferring students in their source class without blocking the section", async () => {
  await api("staff", "post", "/api/transfers", { studentId: oid(students[2]), remark: "Changing schools" }).expect(201);
  const item = await Result.findOne({ cycleId: cycle._id, classId: classes[1]._id });
  await api("principal", "post", `/api/exam-workflow/results/${item._id}/promote`, {
    revision: item.revision, targetClassId: oid(classes[2]),
  }).expect(200);
  const refreshed = await Result.findById(item._id);
  assert.equal(refreshed.promotion.skippedStudentIds[0].toString(), oid(students[2]));
  assert.equal((await Student.findById(students[2]._id)).classId.toString(), oid(classes[1]));
});
test("parent dashboard preserves previous-class results and legacy teacher publishing is blocked", async () => {
  const Exam = require("../src/models/Exam"), ExamResult = require("../src/models/ExamResult");
  const legacy = await Exam.create({ name: "Historical final", subject: "Math", classId: classes[0]._id,
    examDate: new Date("2025-03-01T10:00:00Z"), totalMarks: 100, resultsPublished: true });
  await ExamResult.create({ examId: legacy._id, studentId: students[0]._id, marksObtained: 75 });
  const response = await api("parent", "get", `/api/parent/dashboard?childId=${oid(students[0])}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert(response.body.publishedResults.some(r => r.name === "Historical final"));
  assert(response.body.publishedResults.some(r => r.grade === "A" && r.decision === "pass"));
  assert.equal(response.body.upcomingExams.length, 0);
  await api("math", "put", `/api/teacher/exams/${legacy._id}/results`, { published: true, results: [] }).expect(409);
});
