const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../src/models/User");
const Teacher = require("../src/models/Teacher");
const SchoolClass = require("../src/models/SchoolClass");
const Student = require("../src/models/Student");
const SectionTransferRequest = require("../src/models/SectionTransferRequest");

let mongo, app, tokens, teacherX, teacherY, class7A, class7B, class7C, studentS;

function api(role, method, path, body) {
  const call = request(app)[method](path).set("Authorization", `Bearer ${tokens[role]}`);
  return body === undefined ? call : call.send(body);
}

before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: "7.0.14" }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri("section_transfer_test"));
  process.env.JWT_SECRET = "testsecret123";

  app = express();
  app.use(express.json());
  app.use("/api/teacher", require("../src/routes/teacherPortalRoutes"));
  app.use("/api/section-transfers", require("../src/routes/sectionTransferRoutes"));

  // Create users
  const principalUser = await User.create({
    name: "Principal Sharma",
    email: "principal@test.com",
    passwordHash: "hash",
    role: "principal",
  });

  const userX = await User.create({
    name: "Teacher X",
    email: "teacherx@test.com",
    passwordHash: "hash",
    role: "teacher",
  });

  const userY = await User.create({
    name: "Teacher Y",
    email: "teachery@test.com",
    passwordHash: "hash",
    role: "teacher",
  });

  tokens = {
    principal: jwt.sign({ id: principalUser._id, role: "principal", name: "Principal Sharma" }, process.env.JWT_SECRET),
    teacherX: jwt.sign({ id: userX._id, role: "teacher", name: "Teacher X" }, process.env.JWT_SECRET),
    teacherY: jwt.sign({ id: userY._id, role: "teacher", name: "Teacher Y" }, process.env.JWT_SECRET),
  };

  // Create teachers
  teacherX = await Teacher.create({
    name: "Teacher X",
    firstName: "Teacher",
    lastName: "X",
    phone: "9999999901",
    email: "teacherx@test.com",
    userId: userX._id,
    subject: "Math",
    assignments: [],
  });

  teacherY = await Teacher.create({
    name: "Teacher Y",
    firstName: "Teacher",
    lastName: "Y",
    phone: "9999999902",
    email: "teachery@test.com",
    userId: userY._id,
    subject: "English",
    assignments: [],
  });

  // Create classes 7th A, 7th B, 7th C
  // Teacher X is class teacher of 7th A
  // Teacher Y is class teacher of 7th C
  class7A = await SchoolClass.create({
    name: "7th-A",
    grade: "7th",
    section: "A",
    gradeBand: "Middle",
    classTeacherId: teacherX._id,
    studentCount: 1,
  });

  class7B = await SchoolClass.create({
    name: "7th-B",
    grade: "7th",
    section: "B",
    gradeBand: "Middle",
    studentCount: 0,
  });

  class7C = await SchoolClass.create({
    name: "7th-C",
    grade: "7th",
    section: "C",
    gradeBand: "Middle",
    classTeacherId: teacherY._id,
    studentCount: 0,
  });

  // Teacher X teaches Math in 7th A, 7th B, 7th C
  teacherX.assignments = [
    { classId: class7C._id, subject: "Math" },
    { classId: class7B._id, subject: "Math" },
    { classId: class7A._id, subject: "Math" },
  ];
  await teacherX.save();

  // Create student in 7th A
  studentS = await Student.create({
    name: "Aarav Gupta",
    admissionNo: "ADM001",
    classId: class7A._id,
    rollNo: 1,
  });
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test("Teacher Portal getClasses orders classTeacher class on top and tags isClassTeacher", async () => {
  const res = await api("teacherX", "get", "/api/teacher/classes");
  assert.equal(res.status, 200);
  assert.ok(res.body.classes && res.body.classes.length >= 3);

  // First class MUST be 7th-A where teacherX is Class Teacher!
  const firstClass = res.body.classes[0];
  assert.equal(firstClass.className, "7th-A");
  assert.equal(firstClass.isClassTeacher, true);

  // Other classes must have isClassTeacher = false
  const class7cInList = res.body.classes.find((c) => c.className === "7th-C");
  assert.ok(class7cInList);
  assert.equal(class7cInList.isClassTeacher, false);
});

test("Teacher X creates a section transfer request from 7th-A to 7th-C", async () => {
  const res = await api("teacherX", "post", "/api/section-transfers", {
    studentId: studentS._id,
    toClassId: class7C._id,
    reason: "Parent request for section shift",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.request.status, "pending");
  assert.equal(res.body.request.studentName, "Aarav Gupta");
  assert.equal(res.body.request.fromClassName, "7th-A");
  assert.equal(res.body.request.toClassName, "7th-C");
  assert.equal(res.body.request.targetTeacherName, "Teacher Y");
});

test("Teacher Y sees the request in incoming requests and approves it", async () => {
  // Teacher Y lists requests
  const listRes = await api("teacherY", "get", "/api/section-transfers?type=incoming");
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.requests.length, 1);
  const requestId = listRes.body.requests[0].id;

  // Teacher Y approves
  const approveRes = await api("teacherY", "post", `/api/section-transfers/${requestId}/approve`, {
    note: "Approved by 7th C Class Teacher",
  });
  assert.equal(approveRes.status, 200, JSON.stringify(approveRes.body));
  assert.equal(approveRes.body.request.status, "approved");

  // Verify student is now in 7th-C
  const updatedStudent = await Student.findById(studentS._id);
  assert.equal(updatedStudent.classId.toString(), class7C._id.toString());

  // Verify class studentCounts
  const updated7A = await SchoolClass.findById(class7A._id);
  const updated7C = await SchoolClass.findById(class7C._id);
  assert.equal(updated7A.studentCount, 0);
  assert.equal(updated7C.studentCount, 1);
});
