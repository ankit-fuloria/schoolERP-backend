const User = require("../models/User");
const Student = require("../models/Student");
const AttendanceRecord = require("../models/AttendanceRecord");
const Exam = require("../models/Exam");
const ExamResult = require("../models/ExamResult");
const ExamCycle = require("../models/ExamCycle");
const SectionExamResult = require("../models/SectionExamResult");
const Announcement = require("../models/Announcement");
const TimetableEntry = require("../models/TimetableEntry");
const Subject = require("../models/Subject");
const ClassDiary = require("../models/ClassDiary");
const FeeRecord = require("../models/FeeRecord");
const FeeStructure = require("../models/FeeStructure");
const SchoolSettings = require("../models/SchoolSettings");
const { getSessionMonths, computeMonthlyFee } = require("./feesController");

async function requireParent(req, res) {
  const user = await User.findById(req.user.id);
  if (!user || !user.childStudentIds || user.childStudentIds.length === 0) {
    res.status(403).json({ message: "No children are linked to this account" });
    return null;
  }
  return user;
}

// A parent may only ever act on their own linked children — resolves the
// requested childId against user.childStudentIds (falling back to the first
// linked child), or returns null if the requested id isn't one of theirs.
function resolveChildId(user, requestedId) {
  return requestedId
    ? user.childStudentIds.find((id) => id.toString() === requestedId)
    : user.childStudentIds[0];
}

function serializeStudent(s) {
  return {
    id: s._id,
    name: s.name,
    admissionNo: s.admissionNo,
    rollNo: s.rollNo,
    className: s.classId?.name,
    classId: s.classId?._id,
    gender: s.gender || null,
    dateOfBirth: s.dateOfBirth || null,
    bloodGroup: s.bloodGroup || null,
    category: s.category || null,
    hasDisability: Boolean(s.hasDisability),
    disabilityType: s.disabilityType || null,
    address: s.studentAddress || {},
    father: {
      name: s.fatherDetails?.name || s.fatherName || null,
      primaryPhone: s.fatherDetails?.primaryPhone || s.fatherPhone || null,
      email: s.fatherDetails?.email || null,
      occupation: s.fatherDetails?.occupation || null,
    },
    mother: {
      name: s.motherDetails?.name || s.motherName || null,
      primaryPhone: s.motherDetails?.primaryPhone || s.motherPhone || null,
      email: s.motherDetails?.email || null,
      occupation: s.motherDetails?.occupation || null,
    },
    emergencyContactName: s.emergencyContactName || null,
    emergencyContactPhone: s.emergencyContactPhone || null,
    admissionDate: s.admissionDate || null,
  };
}

async function getChildren(req, res) {
  const user = await requireParent(req, res);
  if (!user) return;

  const children = await Student.find({ _id: { $in: user.childStudentIds } })
    .populate("classId", "name")
    .sort({ name: 1 });
  res.json({ children: children.map(serializeStudent) });
}

async function getDashboard(req, res) {
  const user = await requireParent(req, res);
  if (!user) return;

  const childId = resolveChildId(user, req.query.childId);
  if (!childId) {
    return res.status(403).json({ message: "That child is not linked to this account" });
  }

  const student = await Student.findById(childId).populate("classId", "name grade");
  if (!student) {
    return res.status(404).json({ message: "Student not found" });
  }

  const legacyExamIds = await ExamResult.distinct("examId", { studentId: childId });
  const [totalDays, presentDays, classExams, announcements, settings] = await Promise.all([
    AttendanceRecord.countDocuments({ studentId: childId }),
    AttendanceRecord.countDocuments({ studentId: childId, status: "present" }),
    Exam.find({
      _id: { $in: legacyExamIds },
      resultsPublished: true,
      status: { $ne: "inactive" },
    })
      .sort({ examDate: -1 }),
    Announcement.find({
      status: { $ne: "inactive" },
      $or: [{ audience: "school" }, { audience: "class", classId: student.classId._id }],
    })
      .sort({ createdAt: -1 })
      .limit(5),
    SchoolSettings.findOne().select("schoolName academicYear"),
  ]);
  const examResults = await ExamResult.find({
    studentId: childId,
    examId: { $in: classExams.map((exam) => exam._id) },
  });
  const resultByExam = new Map(examResults.map((result) => [result.examId.toString(), result]));
  const now = new Date();
  const liveCycles = await ExamCycle.find({ datesheetLive: true, grades: student.classId.grade });
  const upcomingExams = liveCycles.flatMap(cycle => cycle.dates
    .filter(d => d.grade === student.classId.grade && d.startsAt >= now)
    .map(d => ({ _id: `${cycle._id}:${d.subjectId}`, name: cycle.name, subject: d.subject,
      examDate: d.startsAt, totalMarks: cycle.maxMarks })))
    .sort((a, b) => a.examDate - b.examDate).slice(0, 5);
  const publishedResults = classExams
    .filter(
      (exam) => exam.resultsPublished && resultByExam.has(exam._id.toString())
    )
    .map((exam) => {
      const result = resultByExam.get(exam._id.toString());
      return {
        id: exam._id,
        name: exam.name,
        subject: exam.subject,
        examDate: exam.examDate,
        totalMarks: exam.totalMarks,
        marksObtained: result.marksObtained,
        remarks: result.remarks,
        resultsPublished: true,
      };
    });

  const liveReports = await SectionExamResult.find({ status: "live", "students.studentId": childId })
    .populate("cycleId");
  for (const report of liveReports) {
    const record = report.students.find(s => s.studentId.toString() === childId.toString());
    if (!record || !report.cycleId) continue;
    for (const mark of record.marks) {
      const subject = report.subjects.find(s => s.subjectId.toString() === mark.subjectId.toString());
      publishedResults.push({ id: `${report._id}:${mark.subjectId}`, name: report.cycleId.name,
        subject: subject?.name, examDate: subject?.endsAt, totalMarks: report.cycleId.maxMarks,
        marksObtained: mark.marksObtained, grade: mark.grade, decision: record.decision,
        remarks: mark.remarks, resultsPublished: true });
    }
  }
  res.json({
    school: {
      name: settings?.schoolName || "School ERP",
      academicYear: settings?.academicYear || null,
    },
    student: serializeStudent(student),
    attendance: {
      percent: totalDays ? Math.round((presentDays / totalDays) * 100) : 0,
      presentDays,
      totalDays,
    },
    upcomingExams: upcomingExams.map((e) => ({
      id: e._id,
      name: e.name,
      subject: e.subject,
      examDate: e.examDate,
      totalMarks: e.totalMarks,
    })),
    publishedResults,
    announcements: announcements.map((a) => ({
      id: a._id,
      title: a.title,
      message: a.message,
      category: a.category,
      createdAt: a.createdAt,
    })),
  });
}

async function getAttendance(req, res) {
  const user = await requireParent(req, res);
  if (!user) return;

  const childId = resolveChildId(user, req.query.childId);
  if (!childId) {
    return res.status(403).json({ message: "That child is not linked to this account" });
  }

  const now = new Date();
  const year = parseInt(req.query.year) || now.getUTCFullYear();
  const month = parseInt(req.query.month) || now.getUTCMonth() + 1; // 1-12

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const records = await AttendanceRecord.find({
    studentId: childId,
    date: { $gte: start, $lt: end },
  }).sort({ date: 1 });

  res.json({
    year,
    month,
    records: records.map((r) => ({ date: r.date, status: r.status })),
  });
}

async function getTimetable(req, res) {
  const user = await requireParent(req, res);
  if (!user) return;

  const childId = resolveChildId(user, req.query.childId);
  if (!childId) {
    return res.status(403).json({ message: "That child is not linked to this account" });
  }
  const student = await Student.findById(childId).select("classId");
  if (!student?.classId) {
    return res.status(404).json({ message: "Student class not found" });
  }

  const entries = await TimetableEntry.find({
    classId: student.classId,
    status: { $ne: "inactive" },
  }).sort({ day: 1, period: 1 });
  res.json({
    entries: entries.map((entry) => ({
      id: entry._id,
      classId: entry.classId,
      day: entry.day,
      period: entry.period,
      periodName: entry.periodName,
      startTime: entry.startTime,
      endTime: entry.endTime,
      subject: entry.subject,
      teacherName: entry.teacherName,
      isBreak: entry.isBreak,
      status: entry.status,
    })),
  });
}

function serializeSyllabusSubject(subject, grade) {
  const curriculum = (subject.curriculum || [])
    .filter((entry) => entry.grade === grade)
    .map((entry) => ({
      grade: entry.grade,
      books: (entry.books || []).map((book) => ({
        bookId: book.bookId?.toString() || null,
        name: book.name,
        chapters: (book.chapters || []).map((chapter) => ({
          name: chapter.name,
          description: chapter.description || null,
          topics: chapter.topics || [],
          term: chapter.term,
        })),
      })),
    }));
  return { id: subject._id, name: subject.name, code: subject.code, description: subject.description, curriculum };
}

async function getSyllabus(req, res) {
  const user = await requireParent(req, res);
  if (!user) return;
  const childId = resolveChildId(user, req.query.childId);
  if (!childId) return res.status(403).json({ message: "That child is not linked to this account" });

  const student = await Student.findById(childId).populate("classId", "name grade section");
  if (!student?.classId) return res.status(404).json({ message: "Student class not found" });

  const subjects = await Subject.find({ classIds: student.classId._id, status: { $ne: "inactive" } }).sort({ name: 1 });
  res.json({
    child: serializeStudent(student),
    class: { id: student.classId._id, name: student.classId.name, grade: student.classId.grade, section: student.classId.section },
    subjects: subjects.map((subject) => serializeSyllabusSubject(subject, student.classId.grade)),
  });
}

async function getAssignments(req, res) {
  const user = await requireParent(req, res);
  if (!user) return;
  const childId = resolveChildId(user, req.query.childId);
  if (!childId) {
    return res.status(403).json({ message: "That child is not linked to this account" });
  }

  const student = await Student.findById(childId).populate("classId", "name");
  if (!student?.classId) {
    return res.status(404).json({ message: "Student class not found" });
  }

  const entries = await ClassDiary.find({
    classId: student.classId._id,
    $or: [
      { homework: { $exists: true, $ne: "" } },
      { classwork: { $exists: true, $ne: "" } },
    ],
  })
    .sort({ date: -1, createdAt: -1 })
    .limit(200);

  res.json({
    child: serializeStudent(student),
    assignments: entries.map((entry) => ({
      id: entry._id,
      date: entry.date,
      subject: entry.subject,
      topic: entry.topicTaught,
      classwork: entry.classwork,
      homework: entry.homework,
      remarks: entry.remarks,
      teacherName: entry.teacherName,
      createdAt: entry.createdAt,
    })),
  });
}

async function getAnnualCharges(req, res) {
  const user = await requireParent(req, res);
  if (!user) return;
  const childId = resolveChildId(user, req.query.childId);
  if (!childId) {
    return res.status(403).json({ message: "That child is not linked to this account" });
  }

  const student = await Student.findById(childId).populate("classId", "name grade");
  if (!student) return res.status(404).json({ message: "Student not found" });

  const [structure, records] = await Promise.all([
    FeeStructure.findOne(),
    FeeRecord.find({ studentId: childId, isActive: { $ne: false } }).sort({ paidDate: -1, createdAt: -1 }),
  ]);
  const monthlyCharge = computeMonthlyFee(structure, student);
  const now = new Date();
  const nowMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const months = getSessionMonths(structure?.sessionStartMonth || 4, now);
  const recordByMonth = new Map(records.map((record) => [record.month, record]));
  const monthlyRecords = months.map((month) => {
    const record = recordByMonth.get(month.label);
    const monthDate = new Date(month.year, month.monthIndex - 1, 1);
    const status = record?.status === "collected"
      ? "collected"
      : monthDate < nowMonth
        ? "overdue"
        : monthDate.getTime() === nowMonth.getTime()
          ? "pending"
          : "upcoming";
    return {
      id: record?._id || null,
      month: month.label,
      amount: record?.amount ?? monthlyCharge,
      status,
      dueDate: record?.dueDate || null,
      paidDate: record?.paidDate || null,
      paymentMode: record?.paymentMode || null,
      transactionRef: record?.transactionRef || null,
      remarks: record?.remarks || null,
    };
  });
  const academicSession = `${months[0].year}-${months[0].year + 1}`;
  const charges = require('../utils/additionalCharges').chargeStatus(structure, student, records, academicSession);
  monthlyRecords.push(...charges.filter(c => c.amount != null).map(c => ({
    id: c.feeRecordId, month: `${c.name} (${academicSession})`, amount: c.amount,
    status: c.status === 'paid' ? 'collected' : 'pending', paidDate: c.paidDate,
    paymentMode: c.paymentMode, transactionRef: c.transactionRef,
  })));
  const collected = monthlyRecords
    .filter((record) => record.status === "collected")
    .reduce((sum, record) => sum + record.amount, 0);
  const pending = monthlyRecords
    .filter((record) => record.status === "pending" || record.status === "upcoming")
    .reduce((sum, record) => sum + record.amount, 0);
  const overdue = monthlyRecords
    .filter((record) => record.status === "overdue")
    .reduce((sum, record) => sum + record.amount, 0);

  res.json({
    child: serializeStudent(student),
    monthlyCharge,
    summary: { total: collected + pending + overdue, collected, pending, overdue },
    records: monthlyRecords,
  });
}

module.exports = {
  getChildren,
  getDashboard,
  getAttendance,
  getTimetable,
  getSyllabus,
  getAssignments,
  getAnnualCharges,
};
