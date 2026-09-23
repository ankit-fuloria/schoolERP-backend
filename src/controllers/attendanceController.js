const AttendanceRecord = require("../models/AttendanceRecord");
const Student = require("../models/Student");
const SchoolClass = require("../models/SchoolClass");
const Teacher = require("../models/Teacher");
const { logAction } = require("../utils/auditLog");

function normalizeDate(input) {
  let year, month, day;
  if (!input) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
    day = now.getDate();
  } else if (typeof input === "string") {
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      year = parseInt(match[1], 10);
      month = parseInt(match[2], 10) - 1;
      day = parseInt(match[3], 10);
    } else {
      const d = new Date(input);
      year = d.getFullYear();
      month = d.getMonth();
      day = d.getDate();
    }
  } else {
    const d = new Date(input);
    year = d.getFullYear();
    month = d.getMonth();
    day = d.getDate();
  }
  return new Date(Date.UTC(year, month, day));
}

async function findTeacherForUser(user) {
  let teacher = await Teacher.findOne({ userId: user.id });
  if (!teacher && user.email) {
    teacher = await Teacher.findOne({ email: user.email.toLowerCase() });
    if (teacher && !teacher.userId) {
      teacher.userId = user.id;
      await teacher.save();
    }
  }
  if (!teacher) {
    teacher = await Teacher.findOne({ status: { $ne: "inactive" } });
    if (teacher && !teacher.userId) {
      teacher.userId = user.id;
      await teacher.save();
    }
  }
  return teacher;
}

// A teacher may only touch attendance for classes they are assigned to.
async function assertClassOwnership(req, res, classId) {
  if (req.user.role !== "teacher") return true;
  const teacher = await findTeacherForUser(req.user);
  if (!teacher) {
    res.status(403).json({ message: "No teacher profile found" });
    return false;
  }
  const schoolClass = await SchoolClass.findById(classId);
  if (!schoolClass) {
    res.status(400).json({ message: "Class does not exist" });
    return false;
  }
  const isClassTeacher =
    schoolClass.classTeacherId &&
    schoolClass.classTeacherId.toString() === teacher._id.toString();
  if (!isClassTeacher) {
    res.status(403).json({
      message: `Attendance restricted: Only the designated Class Teacher can mark attendance for ${schoolClass.name || 'this class'}.`,
    });
    return false;
  }
  return true;
}

async function getRoster(req, res) {
  const { classId, date } = req.query;
  if (!classId || !date) {
    return res.status(400).json({ message: "classId and date are required" });
  }
  if (!(await assertClassOwnership(req, res, classId))) return;

  const day = normalizeDate(date);
  const [students, records] = await Promise.all([
    Student.find({ classId, status: "active" }).sort({ name: 1 }),
    AttendanceRecord.find({ classId, date: day }),
  ]);

  const recordMap = Object.fromEntries(records.map((r) => [r.studentId.toString(), r]));

  res.json({
    date: day.toISOString(),
    students: students.map((s) => {
      const rec = recordMap[s._id.toString()];
      return {
        id: s._id,
        name: s.name,
        admissionNo: s.admissionNo,
        rollNo: s.rollNo,
        status: rec?.status || null,
        lateTime: rec?.lateTime || "",
      };
    }),
  });
}

const SchoolSettings = require("../models/SchoolSettings");
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isWorkingDay(settings, dateObj) {
  const workingDays = settings?.workingDays?.length > 0
    ? settings.workingDays
    : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = DAY_NAMES[dateObj.getUTCDay()];
  return workingDays.some((w) => w.toLowerCase() === dayName.toLowerCase());
}

async function markAttendance(req, res) {
  const { classId, date, records } = req.body;
  if (!classId || !date || !Array.isArray(records)) {
    return res.status(400).json({ message: "classId, date and records are required" });
  }
  if (!(await assertClassOwnership(req, res, classId))) return;

  const schoolClass = await SchoolClass.findById(classId);
  if (!schoolClass) {
    return res.status(400).json({ message: "Class does not exist" });
  }

  const day = normalizeDate(date);

  const settings = (await SchoolSettings.findOne()) || {};
  const dayName = DAY_NAMES[day.getUTCDay()];
  if (!isWorkingDay(settings, day)) {
    return res.status(400).json({
      message: `Cannot mark attendance: ${dayName} is a non-working day according to school settings.`,
    });
  }

  await Promise.all(
    records.map((r) =>
      AttendanceRecord.updateOne(
        { studentId: r.studentId, date: day },
        { $set: { classId, status: r.status, lateTime: r.lateTime || "" } },
        { upsert: true }
      )
    )
  );

  await logAction({
    req,
    entityType: "AttendanceRecord",
    entityId: classId,
    action: "update",
    detail: { classId, date: day, count: records.length },
    note: "Bulk attendance marked",
  });
  res.status(201).json({ message: "Attendance saved", count: records.length });
}

async function getSummary(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const { classId } = req.query;

  const match = {};
  if (classId) match.classId = new (require("mongoose").Types.ObjectId)(classId);

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: { classId: "$classId", date: "$date" },
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
        leave: { $sum: { $cond: [{ $eq: ["$status", "leave"] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } },
        halfDay: { $sum: { $cond: [{ $eq: ["$status", "half_day"] }, 1, 0] } },
      },
    },
    { $sort: { "_id.date": -1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
  ];

  const [sessions, totalAgg] = await Promise.all([
    AttendanceRecord.aggregate(pipeline),
    AttendanceRecord.aggregate([{ $match: match }, { $group: { _id: { classId: "$classId", date: "$date" } } }]),
  ]);

  const classIds = sessions.map((s) => s._id.classId);
  const classes = await SchoolClass.find({ _id: { $in: classIds } });
  const classById = Object.fromEntries(classes.map((c) => [c._id.toString(), c]));

  const total = totalAgg.length;

  res.json({
    items: sessions.map((s) => ({
      classId: s._id.classId,
      className: classById[s._id.classId.toString()]?.name || "",
      date: s._id.date,
      total: s.total,
      present: s.present,
      absent: s.absent,
      leave: s.leave || 0,
      late: s.late,
      halfDay: s.halfDay || 0,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

module.exports = { getRoster, markAttendance, getSummary };
