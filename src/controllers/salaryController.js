const SchoolSettings = require("../models/SchoolSettings");
const Teacher = require("../models/Teacher");
const Staff = require("../models/Staff");
const TeacherAttendance = require("../models/TeacherAttendance");
const { logAction } = require("../utils/auditLog");

async function getConfig(req, res) {
  try {
    let settings = await SchoolSettings.findOne();
    if (!settings) {
      settings = await SchoolSettings.create({});
    }
    res.json(settings.salaryConfig || {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateConfig(req, res) {
  try {
    const {
      schoolStartTime,
      schoolEndTime,
      lateGraceMinutes,
      schoolLatitude,
      schoolLongitude,
      allowedRadiusMeters,
      lateDeductionPercent,
      lateDaysPerHalfDay,
      halfDayDeductionType,
      halfDayDeductionValue,
    } = req.body;

    let settings = await SchoolSettings.findOne();
    if (!settings) {
      settings = new SchoolSettings({});
    }

    const current = settings.salaryConfig || {};
    const parsedLateDays = lateDaysPerHalfDay !== undefined ? Number(lateDaysPerHalfDay) : null;
    const incomingDeductionValue = halfDayDeductionValue !== undefined
      ? halfDayDeductionValue
      : lateDeductionPercent;
    const parsedDeductionValue = incomingDeductionValue !== undefined
      ? Number(incomingDeductionValue)
      : null;
    if (parsedLateDays !== null && (!Number.isFinite(parsedLateDays) || parsedLateDays < 1)) {
      return res.status(400).json({ message: "Late days per half-day must be at least 1" });
    }
    if (parsedDeductionValue !== null && (!Number.isFinite(parsedDeductionValue) || parsedDeductionValue < 0)) {
      return res.status(400).json({ message: "Half-day deduction value must be 0 or greater" });
    }
    if (halfDayDeductionType !== undefined && !["percentage", "fixed"].includes(halfDayDeductionType)) {
      return res.status(400).json({ message: "Half-day deduction type must be percentage or fixed" });
    }

    const normalizedLateDays = parsedLateDays !== null
      ? Math.floor(parsedLateDays)
      : current.lateDaysPerHalfDay || 3;
    const normalizedDeductionType = halfDayDeductionType || current.halfDayDeductionType || "percentage";
    const normalizedDeductionValue = parsedDeductionValue !== null
      ? parsedDeductionValue
      : current.halfDayDeductionValue ?? current.lateDeductionPercent ?? 50;
    if (normalizedDeductionType === "percentage" && normalizedDeductionValue > 100) {
      return res.status(400).json({ message: "Percentage deduction must be between 0 and 100" });
    }

    settings.salaryConfig = {
      schoolStartTime: schoolStartTime || current.schoolStartTime || "08:30",
      schoolEndTime: schoolEndTime || current.schoolEndTime || "15:30",
      lateGraceMinutes: lateGraceMinutes !== undefined ? Number(lateGraceMinutes) : current.lateGraceMinutes ?? 10,
      schoolLatitude: schoolLatitude !== undefined ? Number(schoolLatitude) : current.schoolLatitude ?? 0,
      schoolLongitude: schoolLongitude !== undefined ? Number(schoolLongitude) : current.schoolLongitude ?? 0,
      allowedRadiusMeters: allowedRadiusMeters !== undefined ? Number(allowedRadiusMeters) : current.allowedRadiusMeters ?? 50,
      lateDeductionPercent: normalizedDeductionType === "percentage" ? normalizedDeductionValue : current.lateDeductionPercent ?? 50,
      lateDaysPerHalfDay: normalizedLateDays,
      halfDayDeductionType: normalizedDeductionType,
      halfDayDeductionValue: normalizedDeductionValue,
    };

    await settings.save();

    await logAction({
      req,
      entityType: "SchoolSettings",
      entityId: settings._id,
      action: "update",
      detail: settings.salaryConfig,
      note: "Salary and Attendance config updated",
    });

    res.json({ message: "Salary configuration updated successfully", config: settings.salaryConfig });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function setTeacherSalary(req, res) {
  try {
    const { id } = req.params;
    const { monthlySalary } = req.body;

    const teacher = await Teacher.findByIdAndUpdate(
      id,
      { $set: { monthlySalary: Number(monthlySalary) || 0 } },
      { new: true }
    );

    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    res.json({ message: "Teacher salary updated", teacher });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function setStaffSalary(req, res) {
  try {
    const { id } = req.params;
    const { monthlySalary } = req.body;

    const staff = await Staff.findByIdAndUpdate(
      id,
      { $set: { monthlySalary: Number(monthlySalary) || 0 } },
      { new: true }
    );

    if (!staff) {
      return res.status(404).json({ message: "Staff member not found" });
    }

    res.json({ message: "Staff salary updated", staff });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getSalaryReport(req, res) {
  try {
    const { startDate, endDate } = req.query;

    const [teachers, staffList, settings] = await Promise.all([
      Teacher.find({ status: { $ne: "inactive" } }),
      Staff.find({ status: { $ne: "inactive" } }),
      SchoolSettings.findOne(),
    ]);

    const salaryConfig = settings?.salaryConfig || {};
    const workingDaysCount = (settings?.workingDays || []).length * 4 || 20;

    // Fetch all attendance records within date range
    const filter = {};
    if (startDate && endDate) {
      filter.date = { $gte: startDate, $lte: endDate };
    }

    const attendanceRecords = await TeacherAttendance.find(filter);

    // Group attendance by teacherId
    const attendanceByTeacher = {};
    for (const rec of attendanceRecords) {
      const tid = rec.teacherId.toString();
      if (!attendanceByTeacher[tid]) attendanceByTeacher[tid] = [];
      attendanceByTeacher[tid].push(rec);
    }

    // Build report items for Teachers
    const teacherReports = teachers.map((t) => {
      const records = attendanceByTeacher[t._id.toString()] || [];
      const presentCount = records.filter((r) => r.status === "present").length;
      const lateCount = records.filter((r) => r.status === "late").length;
      const halfDayCount = records.filter((r) => r.status === "half_day").length;
      const leaveCount = records.filter((r) => r.status === "leave").length;
      const recordedDays = presentCount + lateCount + halfDayCount;
      const attendanceEquivalent = presentCount + lateCount + halfDayCount * 0.5;
      const absentCount = Math.max(0, workingDaysCount - recordedDays - leaveCount);

      const totalDeductions = records.reduce((sum, r) => sum + (r.deductionAmount || 0), 0);
      const monthlySalary = t.monthlySalary || 0;
      const netPayable = Math.max(0, monthlySalary - totalDeductions);
      const attPercent = workingDaysCount > 0 ? Math.round((attendanceEquivalent / workingDaysCount) * 100) : 0;

      return {
        id: t._id,
        name: t.name,
        type: "Teacher",
        roleOrDept: t.subject || "Teacher",
        monthlySalary,
        presentDays: presentCount,
        lateDays: lateCount,
        lateHalfDays: halfDayCount,
        absentDays: absentCount,
        leaveDays: leaveCount,
        attendancePercent: attPercent,
        totalDeductions,
        netPayable,
      };
    });

    // Build report items for Staff
    const staffReports = staffList.map((s) => {
      const records = attendanceByTeacher[s._id.toString()] || [];
      const presentCount = records.filter((r) => r.status === "present").length;
      const lateCount = records.filter((r) => r.status === "late").length;
      const halfDayCount = records.filter((r) => r.status === "half_day").length;
      const leaveCount = records.filter((r) => r.status === "leave").length;
      const recordedDays = presentCount + lateCount + halfDayCount;
      const attendanceEquivalent = presentCount + lateCount + halfDayCount * 0.5;
      const absentCount = Math.max(0, workingDaysCount - recordedDays - leaveCount);

      const totalDeductions = records.reduce((sum, r) => sum + (r.deductionAmount || 0), 0);
      const monthlySalary = s.monthlySalary || 0;
      const netPayable = Math.max(0, monthlySalary - totalDeductions);
      const attPercent = workingDaysCount > 0 ? Math.round((attendanceEquivalent / workingDaysCount) * 100) : 0;

      return {
        id: s._id,
        name: s.name,
        type: "Staff",
        roleOrDept: s.department || "Staff",
        monthlySalary,
        presentDays: presentCount,
        lateDays: lateCount,
        lateHalfDays: halfDayCount,
        absentDays: absentCount,
        leaveDays: leaveCount,
        attendancePercent: attPercent,
        totalDeductions,
        netPayable,
      };
    });

    const allReports = [...teacherReports, ...staffReports];

    const totalPayroll = allReports.reduce((sum, r) => sum + r.monthlySalary, 0);
    const totalDeductionsAll = allReports.reduce((sum, r) => sum + r.totalDeductions, 0);
    const totalNetPayableAll = allReports.reduce((sum, r) => sum + r.netPayable, 0);
    const totalLateDaysAll = allReports.reduce((sum, r) => sum + r.lateDays + r.lateHalfDays, 0);

    res.json({
      summary: {
        totalPayroll,
        totalDeductions: totalDeductionsAll,
        totalNetPayable: totalNetPayableAll,
        totalLateDays: totalLateDaysAll,
        workingDaysInMonth: workingDaysCount,
      },
      reports: allReports,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getTeacherDetailAttendance(req, res) {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const [teacher, staff] = await Promise.all([Teacher.findById(id), Staff.findById(id)]);
    const person = teacher || staff;
    if (!person) {
      return res.status(404).json({ message: "Teacher or Staff member not found" });
    }

    const filter = { teacherId: id };
    if (startDate && endDate) {
      filter.date = { $gte: startDate, $lte: endDate };
    }

    const logs = await TeacherAttendance.find(filter).sort({ date: -1 });

    res.json({
      person: {
        id: person._id,
        name: person.name,
        type: teacher ? "Teacher" : "Staff",
        roleOrDept: teacher ? teacher.subject : person.department,
        monthlySalary: person.monthlySalary || 0,
      },
      logs: logs.map((l) => ({
        id: l._id,
        date: l.date,
        checkInTime: l.checkInTime,
        checkInPlace: l.checkInPlace,
        checkOutTime: l.checkOutTime,
        checkOutPlace: l.checkOutPlace,
        status: l.status,
        lateMinutes: l.lateMinutes,
        deductionAmount: l.deductionAmount,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function removeHalfDay(req, res) {
  try {
    const attendance = await TeacherAttendance.findById(req.params.id);
    if (!attendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }
    if (attendance.status !== "half_day") {
      return res.status(400).json({ message: "Only a half-day record can be removed" });
    }

    const previousDeduction = attendance.deductionAmount || 0;
    attendance.status = "late";
    attendance.deductionAmount = 0;
    await attendance.save();

    await logAction({
      req,
      entityType: "TeacherAttendance",
      entityId: attendance._id,
      action: "update",
      detail: {
        date: attendance.date,
        status: "late",
        previousStatus: "half_day",
        previousDeduction,
        deductionAmount: 0,
      },
      note: "Half-day removed by administrator",
    });

    res.json({
      message: "Half-day removed and deduction cleared",
      record: attendance,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = {
  getConfig,
  updateConfig,
  setTeacherSalary,
  setStaffSalary,
  getSalaryReport,
  getTeacherDetailAttendance,
  removeHalfDay,
};
