const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const SchoolClass = require('../src/models/SchoolClass');
const Teacher = require('../src/models/Teacher');
const Subject = require('../src/models/Subject');
const TimetableEntry = require('../src/models/TimetableEntry');
const SchoolSettings = require('../src/models/SchoolSettings');
const { autoGenerateTimetable } = require('../src/controllers/timetableController');

let mongo;

before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('timetable_test'));
});

after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test('autoGenerateTimetable assigns ONLY mapped teachers to the class and never unmapped teachers or dummy staff', async () => {
  // 1. Setup School Settings with period structure
  await SchoolSettings.create({
    timetableStructure: {
      periodsPerDay: 4,
      periodDurationMinutes: 45,
      startTime: '08:00',
      workingDays: ['Monday', 'Tuesday'],
      periods: [
        { periodNo: 1, name: 'Period 1', startTime: '08:00', endTime: '08:45', isBreak: false },
        { periodNo: 2, name: 'Period 2', startTime: '08:45', endTime: '09:30', isBreak: false },
        { periodNo: 3, name: 'Break', startTime: '09:30', endTime: '10:00', isBreak: true },
        { periodNo: 4, name: 'Period 3', startTime: '10:00', endTime: '10:45', isBreak: false },
      ],
    },
  });

  // 2. Setup Classes
  const class10A = await SchoolClass.create({
    name: '10-A',
    grade: '10',
    section: 'A',
    gradeBand: 'Secondary',
    studentCount: 30,
  });

  const class9B = await SchoolClass.create({
    name: '9-B',
    grade: '9',
    section: 'B',
    gradeBand: 'Secondary',
    studentCount: 28,
  });

  const class11A = await SchoolClass.create({
    name: '11-A',
    grade: '11',
    section: 'A',
    gradeBand: 'Senior Secondary',
    studentCount: 25,
  });

  // 3. Setup Teachers:
  // Teacher A: Mapped to 10-A for Mathematics
  const teacherA = await Teacher.create({
    firstName: 'Alice',
    lastName: 'Math',
    name: 'Alice Math',
    phone: '9876543210',
    subject: 'Mathematics',
    status: 'active',
    assignments: [{ classId: class10A._id, className: '10-A', subject: 'Mathematics' }],
  });

  // Teacher B: Mapped to 9-B for Science (NOT mapped to 10-A or 11-A)
  const teacherB = await Teacher.create({
    firstName: 'Bob',
    lastName: 'Science',
    name: 'Bob Science',
    phone: '9876543211',
    subject: 'Science',
    status: 'active',
    assignments: [{ classId: class9B._id, className: '9-B', subject: 'Science' }],
  });

  // Teacher C: Unmapped floating teacher
  const teacherC = await Teacher.create({
    firstName: 'Charlie',
    lastName: 'History',
    name: 'Charlie History',
    phone: '9876543212',
    subject: 'History',
    status: 'active',
    assignments: [],
  });

  // 4. Setup Subjects
  const mathSubject = await Subject.create({
    name: 'Mathematics',
    code: 'MATH10',
    classIds: [class10A._id],
    weeklyLectures: [{ grade: '10', lecturesPerWeek: 2 }],
  });

  const physicsSubject = await Subject.create({
    name: 'Physics',
    code: 'PHY11',
    classIds: [class11A._id],
    weeklyLectures: [{ grade: '11', lecturesPerWeek: 2 }],
  });

  // 5. Test Auto-Generation for Class 10-A
  const req10A = {
    body: {
      classId: class10A._id.toString(),
      session: '2026-2027',
    },
  };
  let responseData;
  const res10A = {
    json: (data) => {
      responseData = data;
    },
  };

  await autoGenerateTimetable(req10A, res10A);

  assert.ok(responseData);
  assert.equal(responseData.totalEntries > 0, true);

  const entries10A = await TimetableEntry.find({ classId: class10A._id });
  assert.equal(entries10A.length > 0, true);

  for (const entry of entries10A) {
    // Must be assigned to Alice Math (teacherA) who is mapped to 10-A
    assert.equal(entry.teacherName, teacherA.name);
    assert.equal(entry.teacherId.toString(), teacherA._id.toString());
    // Must NEVER be assigned to unmapped teachers Bob, Charlie, or dummy 'Teacher Staff'
    assert.notEqual(entry.teacherName, teacherB.name);
    assert.notEqual(entry.teacherName, teacherC.name);
    assert.notEqual(entry.teacherName, 'Teacher Staff');
  }

  // 6. Test Auto-Generation for Class 11-A (no mapped teachers)
  const req11A = {
    body: {
      classId: class11A._id.toString(),
      session: '2026-2027',
    },
  };
  let responseData11A;
  const res11A = {
    json: (data) => {
      responseData11A = data;
    },
  };

  await autoGenerateTimetable(req11A, res11A);

  const entries11A = await TimetableEntry.find({ classId: class11A._id });
  assert.equal(entries11A.length > 0, true);

  for (const entry of entries11A) {
    // Because no teachers are mapped to 11-A, teacherName and teacherId must be undefined
    // NEVER fall back to Bob, Charlie, Alice, or 'Teacher Staff'
    assert.equal(entry.teacherName, undefined);
    assert.equal(entry.teacherId, undefined);
  }
});

test('autoGenerateTimetable NEVER assigns the same subject to consecutive/sequential periods on the same day', async () => {
  const class12A = await SchoolClass.create({
    name: '12-A',
    grade: '12',
    section: 'A',
    gradeBand: 'Senior Secondary',
    studentCount: 35,
  });

  await Subject.create({
    name: 'Mathematics',
    code: 'MATH',
    classIds: [class12A._id],
    weeklyLectures: [{ grade: '12', lecturesPerWeek: 5 }],
  });

  await Subject.create({
    name: 'English',
    code: 'ENGL',
    classIds: [class12A._id],
    weeklyLectures: [{ grade: '12', lecturesPerWeek: 5 }],
  });

  await Subject.create({
    name: 'Science',
    code: 'SCIE',
    classIds: [class12A._id],
    weeklyLectures: [{ grade: '12', lecturesPerWeek: 5 }],
  });

  await Subject.create({
    name: 'Social Studies',
    code: 'SS',
    classIds: [class12A._id],
    weeklyLectures: [{ grade: '12', lecturesPerWeek: 5 }],
  });

  const req = {
    body: {
      classId: class12A._id.toString(),
      session: '2026-2027',
    },
  };
  let resData;
  const res = {
    json: (data) => {
      resData = data;
    },
  };

  await autoGenerateTimetable(req, res);

  assert.ok(resData);
  const entries12A = await TimetableEntry.find({ classId: class12A._id }).lean();
  assert.equal(entries12A.length > 0, true);

  // Group entries by day and sort by period
  const byDay = {};
  for (const e of entries12A) {
    byDay[e.day] = byDay[e.day] || [];
    byDay[e.day].push(e);
  }

  for (const [day, dayEntries] of Object.entries(byDay)) {
    dayEntries.sort((a, b) => a.period - b.period);
    for (let i = 0; i < dayEntries.length - 1; i++) {
      const current = dayEntries[i];
      const next = dayEntries[i + 1];
      // Consecutive active periods must never have the same subject
      assert.notEqual(
        current.subject,
        next.subject,
        `Subject '${current.subject}' is scheduled in consecutive periods (${current.period} and ${next.period}) on ${day}`
      );
    }
  }
});
