const Student = require("../models/Student");
const Teacher = require("../models/Teacher");
const SchoolClass = require("../models/SchoolClass");
const Attendance = require("../models/Attendance");
const AttendanceRecord = require("../models/AttendanceRecord");
const FeeRecord = require("../models/FeeRecord");
const Announcement = require("../models/Announcement");
const ExamCycle = require("../models/ExamCycle");
const LibraryBook = require("../models/LibraryBook");
const TransportRoute = require("../models/TransportRoute");
const timeAgo = require("../utils/timeAgo");
const platform = require("../tenancy/platform");
const Staff = require('../models/Staff');

const GRADE_ORDER = ["Nursery - 5th", "6th - 8th", "9th - 10th", "11th - 12th"];
const ACTIVE = { status: { $ne: "inactive" } };

async function getPrincipalDashboard(req, res) {
  const staff = req.user?.role === 'staff' ? await Staff.findOne({ userId: req.user.id }).select('permissions status') : null;
  if (req.user?.role === 'staff' && (!staff || staff.status === 'inactive')) return res.status(403).json({ message: 'Staff account unavailable' });
  const canRead = section => !staff || staff.permissions.includes(section) || staff.permissions.includes('reports');
  const [
    totalStudents,
    totalTeachers,
    totalClasses,
    attendanceDocs,
    announcementDocs,
    feeRecords,
    studentsByGradeAgg,
    topStudents,
  ] = await Promise.all([
    canRead('students') ? Student.countDocuments(ACTIVE) : 0,
    canRead('teachers') ? Teacher.countDocuments(ACTIVE) : 0,
    canRead('classes') ? SchoolClass.countDocuments(ACTIVE) : 0,
    canRead('attendance') ? Attendance.find().sort({ date: 1 }) : [],
    canRead('communications') ? Announcement.find(ACTIVE).sort({ createdAt: -1 }).limit(4) : [],
    canRead('fees') ? FeeRecord.find({ isActive: { $ne: false } }) : [],
    canRead('students') ? Student.aggregate([
      { $match: { status: { $ne: "inactive" } } },
      {
        $lookup: {
          from: "schoolclasses",
          localField: "classId",
          foreignField: "_id",
          as: "class",
        },
      },
      { $unwind: "$class" },
      { $group: { _id: "$class.gradeBand", count: { $sum: 1 } } },
    ]) : [],
    canRead('students') ? Student.find(ACTIVE).sort({ performancePercent: -1 }).limit(5).populate("classId", "name") : [],
  ]);

  const totalCollectionAmount = feeRecords
    .filter((f) => f.status === "collected")
    .reduce((sum, f) => sum + f.amount, 0);
  const pendingAmount = feeRecords
    .filter((f) => f.status === "pending")
    .reduce((sum, f) => sum + f.amount, 0);
  const overdueAmount = feeRecords
    .filter((f) => f.status === "overdue")
    .reduce((sum, f) => sum + f.amount, 0);
  const feesTotal = totalCollectionAmount + pendingAmount + overdueAmount;

  const gradeCounts = Object.fromEntries(
    studentsByGradeAgg.map((g) => [g._id, g.count])
  );
  const studentsByGrade = GRADE_ORDER.map((label) => {
    const count = gradeCounts[label] || 0;
    return {
      label,
      count,
      percent: totalStudents ? Math.round((count / totalStudents) * 1000) / 10 : 0,
    };
  });

  res.json({
    ...(staff ? { permissions: staff.permissions } : {}),
    stats: {
      totalStudents: { value: totalStudents, delta: "+28 this month" },
      totalTeachers: { value: totalTeachers, delta: "+5 this month" },
      totalClasses: { value: totalClasses, delta: "+2 this month" },
      totalCollection: { value: totalCollectionAmount, delta: "+12.5% this month" },
    },
    attendanceOverview: {
      period: "This Week",
      days: attendanceDocs.map((a) => ({
        day: a.day,
        presentPercent: a.presentPercent,
        absentPercent: a.absentPercent,
      })),
    },
    announcements: announcementDocs.map((a) => ({
      title: a.title,
      message: a.message,
      category: a.category,
      timeAgo: timeAgo(a.createdAt),
    })),
    feesCollection: {
      total: feesTotal,
      collected: totalCollectionAmount,
      pending: pendingAmount,
      overdue: overdueAmount,
    },
    studentsByGrade,
    topStudents: topStudents.map((s, index) => ({
      rank: index + 1,
      name: s.name,
      className: s.classId ? s.classId.name : "",
      percent: s.performancePercent,
    })),
    billingNotice: await (async () => {
      const schoolId = req.tenant?.school?._id;
      if (!schoolId || staff) return { hasUnpaid: false, activeInvoice: null };
      try {
        const platformModels = platform.get();
        if (!platformModels?.Invoice) return { hasUnpaid: false, activeInvoice: null };
        const ownerBilling = require('../services/ownerBilling');
        const allInvoices = await platformModels.Invoice.find({ schoolId }).sort({ createdAt: -1 });
        const pending = allInvoices.map(i => ownerBilling.view(i)).filter(i => i.outstandingMinor > 0)
          .sort((a, b) => new Date(a.nextDueAt) - new Date(b.nextDueAt));
        const unpaidInvoice = pending[0];
        const latestInvoice = unpaidInvoice || allInvoices[0];

        if (!latestInvoice) return { hasUnpaid: false, activeInvoice: null };

        return {
          hasUnpaid: Boolean(unpaidInvoice),
          summary: ownerBilling.summary(allInvoices),
          activeInvoice: {
            id: latestInvoice._id,
            number: latestInvoice.number,
            description: latestInvoice.description,
            amount: require('../services/ownerBilling').view(latestInvoice).nextDueMinor / 100,
            dueDate: require('../services/ownerBilling').view(latestInvoice).nextDueDate || latestInvoice.dueDate,
            dueAt: require('../services/ownerBilling').view(latestInvoice).nextDueAt || latestInvoice.dueAt,
            status: latestInvoice.status,
            cycle: latestInvoice.cycle,
            cycleAmount: (latestInvoice.cycleAmountMinor || 0) / 100,
            maintenanceAmount: (latestInvoice.maintenanceAmountMinor || 0) / 100,
          },
        };
      } catch (_) {
        return { hasUnpaid: false, activeInvoice: null };
      }
    })(),
  });
}

async function getPrincipalReports(req, res) {
  const [
    studentActive,
    studentInactive,
    teacherActive,
    teacherInactive,
    libraryBooks,
    transportRoutes,
    atRiskStudents,
    overdueFees,
    upcomingExamsCount,
    classAttendanceAgg,
  ] = await Promise.all([
    Student.countDocuments({ status: { $ne: "inactive" } }),
    Student.countDocuments({ status: "inactive" }),
    Teacher.countDocuments({ status: { $ne: "inactive" } }),
    Teacher.countDocuments({ status: "inactive" }),
    LibraryBook.find(ACTIVE),
    TransportRoute.find(ACTIVE),
    Student.find({ status: { $ne: "inactive" } })
      .sort({ performancePercent: 1 })
      .limit(5)
      .populate("classId", "name"),
    FeeRecord.find({ status: "overdue", isActive: { $ne: false } })
      .sort({ amount: -1 })
      .limit(5)
      .populate("studentId", "name admissionNo"),
    ExamCycle.countDocuments({
      "dates.startsAt": { $gte: new Date() },
    }),
    AttendanceRecord.aggregate([
      {
        $group: {
          _id: "$classId",
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
        },
      },
      {
        $lookup: {
          from: "schoolclasses",
          localField: "_id",
          foreignField: "_id",
          as: "class",
        },
      },
      { $unwind: "$class" },
      {
        $project: {
          className: "$class.name",
          attendanceRate: { $multiply: [{ $divide: ["$present", "$total"] }, 100] },
        },
      },
      { $sort: { attendanceRate: -1 } },
    ]),
  ]);

  const libraryStats = {
    totalTitles: libraryBooks.length,
    totalCopies: libraryBooks.reduce((sum, b) => sum + (b.totalCopies || 0), 0),
    availableCopies: libraryBooks.reduce((sum, b) => sum + (b.availableCopies || 0), 0),
  };

  const transportStats = {
    totalRoutes: transportRoutes.length,
    totalCapacity: transportRoutes.reduce((sum, r) => sum + (r.capacity || 0), 0),
  };

  res.json({
    studentStatus: { active: studentActive, inactive: studentInactive },
    teacherStatus: { active: teacherActive, inactive: teacherInactive },
    library: libraryStats,
    transport: transportStats,
    upcomingExamsCount,
    atRiskStudents: atRiskStudents.map((s) => ({
      name: s.name,
      className: s.classId ? s.classId.name : "",
      percent: s.performancePercent,
    })),
    overdueFees: overdueFees.map((f) => ({
      studentName: f.studentId ? f.studentId.name : "Unknown",
      admissionNo: f.studentId ? f.studentId.admissionNo : "",
      amount: f.amount,
      month: f.month,
    })),
    classAttendanceRanking: classAttendanceAgg.map((c) => ({
      className: c.className,
      attendanceRate: Math.round(c.attendanceRate * 10) / 10,
    })),
  });
}

async function getPrincipalBilling(req, res) {
  const schoolId = req.tenant?.school?._id;
  if (!schoolId) {
    return res.json({ subscription: null, invoices: [] });
  }

  const { Invoice, School } = platform.get();
  const school = await School.findById(schoolId).select("name code subscription pricing active");
  const ledger = await require('../services/ownerBilling').ledger(schoolId);
  const invoices = await Invoice.find({ schoolId }).sort({ createdAt: -1 });

  res.json({
    school: { name: school?.name, code: school?.code, active: school?.active },
    schoolAccess: req.tenant.schoolAccess || 'active',
    pricing: school?.pricing || null,
    ledger,
    subscription: school?.subscription || null,
    invoices: invoices.map((inv) => ({
      id: inv._id,
      number: inv.number,
      description: inv.description,
      amount: (inv.amountMinor || 0) / 100,
      cycle: inv.cycle,
      cycleAmount: (inv.cycleAmountMinor || 0) / 100,
      maintenanceAmount: (inv.maintenanceAmountMinor || 0) / 100,
      billingDate: inv.billingDate,
      dueDate: inv.dueDate,
      dueAt: inv.dueAt,
      status: inv.status,
      paymentReference: inv.paymentReference,
      paidAt: inv.paidAt,
      createdAt: inv.createdAt,
    })),
  });
}

module.exports = { getPrincipalDashboard, getPrincipalReports, getPrincipalBilling };
