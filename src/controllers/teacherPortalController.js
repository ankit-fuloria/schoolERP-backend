const Teacher = require("../models/Teacher");
const SchoolClass = require("../models/SchoolClass");
const Student = require("../models/Student");
const TimetableEntry = require("../models/TimetableEntry");
const Exam = require("../models/Exam");
const ExamResult = require("../models/ExamResult");
const ExamCycle = require("../models/ExamCycle");
const SectionExamResult = require("../models/SectionExamResult");
const Announcement = require("../models/Announcement");
const SchoolSettings = require("../models/SchoolSettings");
const ClassDiary = require("../models/ClassDiary");
const Subject = require("../models/Subject");
const { logAction } = require("../utils/auditLog");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function requireTeacher(req, res) {
  let teacher = await Teacher.findOne({ userId: req.user.id }).populate(
    "assignments.classId",
    "name grade section studentCount classTeacherId"
  );
  if (!teacher && req.user?.email) {
    teacher = await Teacher.findOne({ email: req.user.email.toLowerCase() }).populate(
      "assignments.classId",
      "name grade section studentCount classTeacherId"
    );
    if (teacher && !teacher.userId) {
      teacher.userId = req.user.id;
      await teacher.save();
    }
  }
  if (!teacher) {
    res.status(403).json({ message: "No teacher profile is linked to this account" });
    return null;
  }
  const ctClasses = await SchoolClass.find({
    classTeacherId: teacher._id,
    status: { $ne: "inactive" },
  }).select("_id name grade section studentCount classTeacherId");
  teacher.classTeacherClasses = ctClasses;
  return teacher;
}

function myClassIds(teacher) {
  const assignmentIds = (teacher.assignments || []).map(
    (a) => (a.classId?._id || a.classId).toString()
  );
  const ctIds = (teacher.classTeacherClasses || []).map((c) => c._id.toString());
  return [...new Set([...assignmentIds, ...ctIds])];
}

function ownsExam(teacher, exam) {
  const examClassId = (exam.classId?._id || exam.classId).toString();
  return (teacher.assignments || []).some(
    (a) => (a.classId?._id || a.classId).toString() === examClassId && a.subject === exam.subject
  );
}

async function getMe(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const settings = await SchoolSettings.findOne().select("schoolName academicYear");

  res.json({
    id: teacher._id,
    name: teacher.name,
    subject: teacher.subject,
    email: teacher.email,
    schoolName: settings?.schoolName || "School ERP",
    academicYear: settings?.academicYear || null,
    assignments: teacher.assignments.map((a) => ({
      classId: a.classId?._id || a.classId,
      className: a.classId?.name,
      studentCount: a.classId?.studentCount || 0,
      subject: a.subject,
    })),
  });
}

async function getDashboard(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const classIds = myClassIds(teacher);
  const today = DAY_NAMES[new Date().getDay()];

  const [totalStudents, todayPeriods, examReports, announcements] = await Promise.all([
    Student.countDocuments({ classId: { $in: classIds }, status: { $ne: "inactive" } }),
    TimetableEntry.find({ teacherId: teacher._id, day: today, status: { $ne: "inactive" } })
      .sort({ period: 1 })
      .populate("classId", "name"),
    SectionExamResult.find({ classId: { $in: classIds }, status: "draft" }).select("classId subjects"),
    Announcement.find({
      status: { $ne: "inactive" },
      $or: [{ audience: "school" }, { audience: "class", classId: { $in: classIds } }],
    })
      .sort({ createdAt: -1 })
      .limit(5),
  ]);

  const now = new Date();
  const pendingGradingCount = examReports.reduce((count, report) => count + report.subjects.filter(subject =>
    !subject.submitted && subject.endsAt <= now && teacher.assignments.some(a =>
      (a.classId?._id || a.classId).toString() === report.classId.toString() && a.subject === subject.name)).length, 0);
  const examClasses = await SchoolClass.find({ $or: [{ _id: { $in: classIds } }, { classTeacherId: teacher._id }] }).select("grade");
  const grades = [...new Set(examClasses.map(c => c.grade))];
  const upcomingCycles = await ExamCycle.find({ grades: { $in: grades }, "dates.startsAt": { $gte: now } }).select("dates");
  const upcomingExams = upcomingCycles.reduce((count, cycle) => count + cycle.dates.filter(d => grades.includes(d.grade) && d.startsAt >= now).length, 0);

  const settings = await SchoolSettings.findOne();
  const periodTimesMap = {};
  (settings?.lecturePeriods || []).forEach((lp) => {
    if (lp.periodNo && lp.startTime && lp.endTime) {
      periodTimesMap[lp.periodNo] = `${lp.startTime} - ${lp.endTime}`;
    }
  });

  res.json({
    totalClasses: classIds.length,
    totalStudents,
    periodTimes: periodTimesMap,
    todayPeriods: todayPeriods.map((p) => {
      const times = periodTimesMap[p.period] || "";
      const [st, et] = times.split(" - ");
      return {
        period: p.period,
        subject: p.subject,
        className: p.classId?.name,
        startTime: p.startTime || st || "",
        endTime: p.endTime || et || "",
        timeSlot: times,
      };
    }),
    upcomingExamsCount: upcomingExams,
    pendingGradingCount,
    recentAnnouncements: announcements.map((a) => ({
      id: a._id,
      title: a.title,
      message: a.message,
      category: a.category,
      createdAt: a.createdAt,
    })),
  });
}

async function getClasses(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const ctClasses = teacher.classTeacherClasses || [];
  const ctClassIdSet = new Set(ctClasses.map((c) => c._id.toString()));

  const classes = (teacher.assignments || []).map((a) => {
    const cid = (a.classId?._id || a.classId)?.toString();
    const isCT = ctClassIdSet.has(cid);
    return {
      classId: cid,
      className: a.classId?.name,
      grade: a.classId?.grade,
      section: a.classId?.section,
      studentCount: a.classId?.studentCount || 0,
      subject: a.subject,
      isClassTeacher: isCT,
    };
  });

  for (const c of ctClasses) {
    if (!classes.some((item) => item.classId === c._id.toString())) {
      classes.push({
        classId: c._id.toString(),
        className: c.name,
        grade: c.grade,
        section: c.section,
        studentCount: c.studentCount || 0,
        subject: "Class Teacher",
        isClassTeacher: true,
      });
    }
  }

  // Show class teacher's class on top
  classes.sort((a, b) => {
    if (a.isClassTeacher && !b.isClassTeacher) return -1;
    if (!a.isClassTeacher && b.isClassTeacher) return 1;
    return (a.className || "").localeCompare(b.className || "", undefined, { numeric: true });
  });

  res.json({ classes });
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

async function getSyllabusClasses(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const grades = [...new Set(
    (teacher.assignments || [])
      .map((assignment) => assignment.classId?.grade)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  res.json({ grades: grades.map((grade) => ({ grade, name: `${grade} Syllabus` })) });
}

async function getGradeSyllabus(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const { grade } = req.params;
  const classIds = (teacher.assignments || [])
    .filter((assignment) => assignment.classId?.grade === grade)
    .map((assignment) => assignment.classId?._id || assignment.classId);
  if (!classIds.length) {
    return res.status(403).json({ message: "You are not assigned to this grade" });
  }
  const subjects = await Subject.find({ classIds: { $in: classIds }, status: { $ne: "inactive" } }).sort({ name: 1 });
  res.json({
    grade,
    subjects: subjects.map((subject) => serializeSyllabusSubject(subject, grade)),
  });
}

async function getClassStudents(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const { classId } = req.params;
  if (!myClassIds(teacher).includes(classId)) {
    return res.status(403).json({ message: "You are not assigned to this class" });
  }

  const schoolClass = await SchoolClass.findById(classId);
  const isClassTeacher = Boolean(
    schoolClass?.classTeacherId &&
    schoolClass.classTeacherId.toString() === teacher._id.toString()
  );

  const students = await Student.find({ classId, status: { $ne: "inactive" } })
    .populate({
      path: "siblingIds",
      select: "name admissionNo rollNo classId",
      populate: { path: "classId", select: "name" },
    })
    .sort({ name: 1 });

  res.json({
    className: schoolClass?.name || "",
    isClassTeacher,
    students: students.map((s) => ({
      id: s._id,
      name: s.name,
      admissionNo: s.admissionNo,
      rollNo: s.rollNo,
      gender: s.gender,
      dateOfBirth: s.dateOfBirth,
      bloodGroup: s.bloodGroup,
      category: s.category,
      fatherName: s.fatherName,
      fatherPhone: s.fatherPhone,
      motherName: s.motherName,
      motherPhone: s.motherPhone,
      emergencyContactName: s.emergencyContactName,
      emergencyContactPhone: s.emergencyContactPhone,
      address: s.address,
      admissionDate: s.admissionDate,
      attendancePercent: s.attendancePercent,
      performancePercent: s.performancePercent,
      hasDisability: s.hasDisability,
      disabilityType: s.disabilityType,
      siblings: (s.siblingIds || []).map((sib) => ({
        id: sib._id ? sib._id.toString() : String(sib),
        name: sib.name || "Sibling",
        admissionNo: sib.admissionNo || "",
        className: sib.classId?.name || "",
        rollNo: sib.rollNo,
      })),
    })),
  });
}

async function getTimetable(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const entries = await TimetableEntry.find({
    status: { $ne: "inactive" },
    $or: [
      { teacherId: teacher._id },
      { teacherName: { $regex: new RegExp(`^${teacher.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } },
    ],
  })
    .sort({ day: 1, period: 1 })
    .populate("classId", "name grade section");

  const settings = await SchoolSettings.findOne();
  const days = settings?.workingDays?.length > 0
    ? settings.workingDays
    : DAY_NAMES.slice(1, 7);

  const periodTimesMap = {};
  (settings?.lecturePeriods || []).forEach((lp) => {
    if (lp.periodNo && lp.startTime && lp.endTime) {
      periodTimesMap[lp.periodNo] = `${lp.startTime} - ${lp.endTime}`;
    }
  });

  res.json({
    teacherName: teacher.name,
    periodTimes: periodTimesMap,
    days: days.map((day) => ({
      day,
      periods: entries
        .filter((e) => e.day === day)
        .map((e) => {
          const times = periodTimesMap[e.period] || "";
          const [st, et] = times.split(" - ");
          return {
            period: e.period,
            subject: e.subject,
            className: e.classId?.name || e.className || "-",
            teacherName: e.teacherName || teacher.name,
            room: e.roomNo || e.section || "Room 101",
            startTime: e.startTime || st || "",
            endTime: e.endTime || et || "",
            isBreak: e.isBreak === true || e.subject.toLowerCase().includes("break"),
          };
        }),
    })),
  });
}

async function getEditableClassTimetable(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const { classId } = req.params;
  if (!myClassIds(teacher).includes(classId)) {
    return res.status(403).json({ message: "You are not assigned to this class" });
  }
  const entries = await TimetableEntry.find({
    classId,
    status: { $ne: "inactive" },
  })
    .populate("classId", "name grade section")
    .populate("teacherId", "name")
    .sort({ day: 1, period: 1 });
  res.json({ items: entries, page: 1, totalPages: 1, total: entries.length });
}

function teacherOwnsSubject(teacher, classId, subject) {
  return (teacher.assignments || []).some(
    (assignment) =>
      (assignment.classId?._id || assignment.classId).toString() === classId.toString() &&
      assignment.subject.trim().toLowerCase() === subject.trim().toLowerCase()
  );
}

async function saveEditableTimetableEntry(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const existing = req.params.id ? await TimetableEntry.findById(req.params.id) : null;
  if (req.params.id && !existing) {
    return res.status(404).json({ message: "Timetable period not found" });
  }
  const classId = req.body.classId || existing?.classId?.toString();
  const subject = (req.body.subject || existing?.subject || "").trim();
  const day = req.body.day || existing?.day;
  const period = Number(req.body.period || existing?.period);
  if (!classId || !subject || !day || !Number.isInteger(period) || period < 1) {
    return res.status(400).json({ message: "classId, subject, day and period are required" });
  }
  if (!teacherOwnsSubject(teacher, classId, subject)) {
    return res.status(403).json({ message: "You can only schedule a subject assigned to you for this class" });
  }
  if (
    existing &&
    existing.teacherId?.toString() !== teacher._id.toString() &&
    existing.teacherName?.trim().toLowerCase() !== teacher.name.trim().toLowerCase()
  ) {
    return res.status(403).json({ message: "You cannot edit another teacher's period" });
  }

  const conflictFilter = {
    status: { $ne: "inactive" },
    day,
    period,
    $or: [{ classId }, { teacherId: teacher._id }],
  };
  if (existing) conflictFilter._id = { $ne: existing._id };
  const conflict = await TimetableEntry.findOne(conflictFilter);
  if (conflict) {
    return res.status(409).json({ message: "This class or teacher already has a period at that time" });
  }

  const schoolClass = await SchoolClass.findById(classId);
  if (!schoolClass) return res.status(404).json({ message: "Class not found" });
  const settings = await SchoolSettings.findOne();
  const lecturePeriod = (settings?.lecturePeriods || []).find((item) => item.periodNo === period);
  const fields = {
    classId,
    className: schoolClass.name,
    grade: schoolClass.grade,
    section: schoolClass.section,
    session: req.body.session || existing?.session || settings?.academicYear || undefined,
    day,
    period,
    periodName: lecturePeriod?.name || `Period ${period}`,
    startTime: req.body.startTime || lecturePeriod?.startTime || existing?.startTime,
    endTime: req.body.endTime || lecturePeriod?.endTime || existing?.endTime,
    subject,
    teacherId: teacher._id,
    teacherName: teacher.name,
    isBreak: false,
    status: "active",
  };
  const entry = existing
    ? await TimetableEntry.findByIdAndUpdate(existing._id, fields, { new: true, runValidators: true })
    : await TimetableEntry.create(fields);
  res.status(existing ? 200 : 201).json(entry);
}

async function deleteEditableTimetableEntry(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const entry = await TimetableEntry.findById(req.params.id);
  if (!entry) return res.status(404).json({ message: "Timetable period not found" });
  if (
    entry.teacherId?.toString() !== teacher._id.toString() &&
    entry.teacherName?.trim().toLowerCase() !== teacher.name.trim().toLowerCase()
  ) {
    return res.status(403).json({ message: "You cannot remove another teacher's period" });
  }
  entry.status = "inactive";
  await entry.save();
  res.json({ message: "Timetable period removed" });
}

async function getExams(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const classIds = myClassIds(teacher);
  const candidates = await Exam.find({
    classId: { $in: classIds },
    status: { $ne: "inactive" },
  })
    .sort({ examDate: -1 })
    .populate("classId", "name studentCount");

  const myExams = candidates.filter((e) => ownsExam(teacher, e));
  const gradedCounts = await ExamResult.aggregate([
    { $match: { examId: { $in: myExams.map((e) => e._id) } } },
    { $group: { _id: "$examId", count: { $sum: 1 } } },
  ]);
  const gradedByExam = Object.fromEntries(gradedCounts.map((g) => [g._id.toString(), g.count]));

  res.json({
    exams: myExams.map((e) => ({
      id: e._id,
      name: e.name,
      subject: e.subject,
      className: e.classId?.name,
      classId: e.classId?._id,
      examDate: e.examDate,
      totalMarks: e.totalMarks,
      studentCount: e.classId?.studentCount || 0,
      gradedCount: gradedByExam[e._id.toString()] || 0,
      resultsPublished: Boolean(e.resultsPublished),
    })),
  });
}

async function getExamResults(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const exam = await Exam.findById(req.params.examId);
  if (!exam || !ownsExam(teacher, exam)) {
    return res.status(403).json({ message: "You cannot grade this exam" });
  }

  const [students, results] = await Promise.all([
    Student.find({ classId: exam.classId, status: { $ne: "inactive" } }).sort({ name: 1 }),
    ExamResult.find({ examId: exam._id }),
  ]);
  const resultByStudent = Object.fromEntries(results.map((r) => [r.studentId.toString(), r]));

  res.json({
    exam: { id: exam._id, name: exam.name, subject: exam.subject, totalMarks: exam.totalMarks },
    students: students.map((s) => ({
      id: s._id,
      name: s.name,
      admissionNo: s.admissionNo,
      marksObtained: resultByStudent[s._id.toString()]?.marksObtained ?? null,
      remarks: resultByStudent[s._id.toString()]?.remarks ?? "",
    })),
  });
}

async function saveExamResults(req, res) {
  // Legacy exams remain readable; new marks use the approval workflow.
  return res.status(409).json({ message: "Use the exam workflow to submit marks for class-teacher approval" });
}

async function getAnnouncements(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const classIds = myClassIds(teacher);
  const announcements = await Announcement.find({
    status: { $ne: "inactive" },
    $or: [{ audience: "school" }, { audience: "class", classId: { $in: classIds } }],
  })
    .sort({ createdAt: -1 })
    .populate("classId", "name");

  res.json({
    announcements: announcements.map((a) => ({
      id: a._id,
      title: a.title,
      message: a.message,
      category: a.category,
      audience: a.audience,
      className: a.classId?.name,
      createdByName: a.createdByName,
      createdAt: a.createdAt,
    })),
  });
}

async function createAnnouncement(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const { title, message, classId, category } = req.body;
  if (!title || !message || !classId) {
    return res.status(400).json({ message: "title, message and classId are required" });
  }
  if (!myClassIds(teacher).includes(classId)) {
    return res.status(403).json({ message: "You are not assigned to this class" });
  }

  const announcement = await Announcement.create({
    title,
    message,
    category: category || "notice",
    audience: "class",
    classId,
    createdByName: teacher.name,
    createdByRole: "teacher",
  });

  res.status(201).json({ id: announcement._id });
}

function maskEmail(email) {
  if (!email || !email.includes("@")) return email || "";
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local.charAt(0)}*@${domain}`;
  return `${local.charAt(0)}${"*".repeat(Math.max(1, local.length - 2))}${local.charAt(local.length - 1)}@${domain}`;
}

async function requestPasswordResetOtp(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const user = await User.findById(req.user.id) || await User.findOne({ email: teacher.email?.toLowerCase() });
  if (!user) {
    return res.status(404).json({ message: "User profile not found for password reset" });
  }

  const registeredEmail = user.email || teacher.email;
  if (!registeredEmail) {
    return res.status(400).json({ message: "No registered email address found for your profile" });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  user.resetOtp = otp;
  user.resetOtpExpires = expires;
  await user.save();

  console.log(`=======================================================`);
  console.log(`[EMAIL DISPATCH] OTP SENT TO REGISTERED MAIL: ${registeredEmail}`);
  console.log(`[EMAIL DISPATCH] SUBJECT: Schoolo Password Reset OTP`);
  console.log(`[EMAIL DISPATCH] BODY: Your OTP code is ${otp}. Valid for 10 minutes.`);
  console.log(`=======================================================`);

  res.json({
    message: `OTP sent to registered email: ${maskEmail(registeredEmail)}`,
    email: maskEmail(registeredEmail),
    otp: otp, // Returned for dev testing visibility
  });
}

async function verifyPasswordResetOtp(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const { otp } = req.body;
  if (!otp || String(otp).trim().length !== 6) {
    return res.status(400).json({ message: "A valid 6-digit OTP is required" });
  }

  const user = await User.findById(req.user.id) || await User.findOne({ email: teacher.email?.toLowerCase() });
  if (!user) {
    return res.status(404).json({ message: "User profile not found" });
  }

  if (!user.resetOtp || user.resetOtp !== String(otp).trim()) {
    return res.status(400).json({ message: "Invalid OTP. Please check your email and try again." });
  }

  if (!user.resetOtpExpires || user.resetOtpExpires < new Date()) {
    return res.status(400).json({ message: "OTP has expired. Please request a new OTP." });
  }

  res.json({ message: "OTP verified successfully!", valid: true });
}

async function changePasswordWithOtp(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const { otp, newPassword } = req.body;
  if (!otp || String(otp).trim().length !== 6) {
    return res.status(400).json({ message: "A valid 6-digit OTP is required" });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "New password must be at least 6 characters long" });
  }

  const user = await User.findById(req.user.id) || await User.findOne({ email: teacher.email?.toLowerCase() });
  if (!user) {
    return res.status(404).json({ message: "User profile not found" });
  }

  if (!user.resetOtp || user.resetOtp !== String(otp).trim()) {
    return res.status(400).json({ message: "Invalid OTP. Please check your email and try again." });
  }

  if (!user.resetOtpExpires || user.resetOtpExpires < new Date()) {
    return res.status(400).json({ message: "OTP has expired. Please request a new OTP." });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  user.passwordHash = passwordHash;
  user.resetOtp = null;
  user.resetOtpExpires = null;
  await user.save();

  await logAction({
    userId: user._id,
    userRole: "teacher",
    action: "update_password",
    detail: { teacherId: teacher._id },
    note: "Teacher changed password via OTP",
  });

  res.json({ message: "Password changed successfully! You can now log in with your new password." });
}

function getTodayDiaryString(d) {
  const now = d ? new Date(d) : new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getClassDiary(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const { classId, date } = req.query;
  if (!classId) {
    return res.status(400).json({ message: "classId is required" });
  }

  const queryDate = date || getTodayDiaryString();
  const schoolClass = await SchoolClass.findById(classId);
  if (!schoolClass) {
    return res.status(404).json({ message: "Class not found" });
  }

  const isClassTeacher =
    schoolClass.classTeacherId &&
    schoolClass.classTeacherId.toString() === teacher._id.toString();

  const isAssignedTeacher = teacher.assignments.some(
    (a) => (a.classId?._id || a.classId).toString() === classId.toString()
  );

  if (!isClassTeacher && !isAssignedTeacher) {
    return res.status(403).json({ message: "You are not assigned to teach this class" });
  }

  const entries = await ClassDiary.find({
    classId,
    date: queryDate,
  }).sort({ createdAt: -1 });

  res.json({
    date: queryDate,
    className: schoolClass.name,
    isClassTeacher: Boolean(isClassTeacher),
    entries: entries.map((e) => ({
      id: e._id,
      classId: e.classId,
      subject: e.subject,
      teacherId: e.teacherId,
      teacherName: e.teacherName,
      date: e.date,
      topicTaught: e.topicTaught,
      classwork: e.classwork,
      homework: e.homework,
      remarks: e.remarks,
      createdAt: e.createdAt,
      isMyEntry: e.teacherId.toString() === teacher._id.toString(),
    })),
  });
}

async function createClassDiaryEntry(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const { classId, subject, topicTaught, classwork, homework, remarks, date } = req.body;
  if (!classId || !subject || !topicTaught) {
    return res.status(400).json({ message: "classId, subject, and topicTaught are required" });
  }

  const schoolClass = await SchoolClass.findById(classId);
  if (!schoolClass) {
    return res.status(404).json({ message: "Class not found" });
  }

  const isClassTeacher =
    schoolClass.classTeacherId &&
    schoolClass.classTeacherId.toString() === teacher._id.toString();

  const isSubjectTeacher = teacher.assignments.some(
    (a) =>
      (a.classId?._id || a.classId).toString() === classId.toString() &&
      a.subject.trim().toLowerCase() === subject.trim().toLowerCase()
  );

  if (!isClassTeacher && !isSubjectTeacher) {
    return res.status(403).json({ message: "You are not assigned to teach this class" });
  }

  const entryDate = date || getTodayDiaryString();

  const entry = await ClassDiary.create({
    classId,
    subject: subject.trim(),
    teacherId: teacher._id,
    teacherName: teacher.name,
    date: entryDate,
    topicTaught: topicTaught.trim(),
    classwork: (classwork || "").trim(),
    homework: (homework || "").trim(),
    remarks: (remarks || "").trim(),
  });

  res.status(201).json({
    message: "Daily entry saved successfully!",
    entry: {
      id: entry._id,
      classId: entry.classId,
      subject: entry.subject,
      teacherId: entry.teacherId,
      teacherName: entry.teacherName,
      date: entry.date,
      topicTaught: entry.topicTaught,
      classwork: entry.classwork,
      homework: entry.homework,
      remarks: entry.remarks,
      createdAt: entry.createdAt,
      isMyEntry: true,
    },
  });
}

async function deleteClassDiaryEntry(req, res) {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;

  const { id } = req.params;
  const entry = await ClassDiary.findById(id);
  if (!entry) {
    return res.status(404).json({ message: "Daily entry not found" });
  }

  if (entry.teacherId.toString() !== teacher._id.toString()) {
    return res.status(403).json({ message: "You can only delete your own daily entries" });
  }

  await entry.deleteOne();
  res.json({ message: "Daily entry deleted" });
}

module.exports = {
  getMe,
  getDashboard,
  getClasses,
  getSyllabusClasses,
  getGradeSyllabus,
  getClassStudents,
  getTimetable,
  getEditableClassTimetable,
  saveEditableTimetableEntry,
  deleteEditableTimetableEntry,
  getExams,
  getExamResults,
  saveExamResults,
  getAnnouncements,
  createAnnouncement,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  changePasswordWithOtp,
  getClassDiary,
  createClassDiaryEntry,
  deleteClassDiaryEntry,
};
