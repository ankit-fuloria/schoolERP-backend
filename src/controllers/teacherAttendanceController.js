const Teacher = require("../models/Teacher");
const TeacherAttendance = require("../models/TeacherAttendance");
const SchoolSettings = require("../models/SchoolSettings");

function getTodayString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getDayName(dateObj = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  }).format(dateObj);
}

function getISTParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "numeric",
    minute: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const minute = parseInt(parts.find((p) => p.type === "minute").value, 10);
  return { hour, minute };
}

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
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

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isWorkingDay(settings, dateObj) {
  const workingDays = settings?.workingDays?.length > 0
    ? settings.workingDays
    : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = getDayName(dateObj);
  return workingDays.some((w) => w.toLowerCase() === dayName.toLowerCase());
}

async function getCheckStatus(req, res) {
  try {
    const teacher = await findTeacherForUser(req.user);
    if (!teacher) {
      return res.status(403).json({ message: "No teacher profile found" });
    }

    const todayStr = getTodayString();
    const settings = (await SchoolSettings.findOne()) || {};
    const todayDate = new Date();
    const dayName = getDayName(todayDate);
    const working = isWorkingDay(settings, todayDate);

    const record = await TeacherAttendance.findOne({
      teacherId: teacher._id,
      date: todayStr,
    });

    if (!record) {
      return res.json({
        isWorkingDay: working,
        workingDayMessage: working ? "" : `Today (${dayName}) is a non-working day.`,
        checkIn: null,
        checkOut: null,
      });
    }

    res.json({
      isWorkingDay: working,
      workingDayMessage: working ? "" : `Today (${dayName}) is a non-working day.`,
      checkIn: record.checkInTime
        ? {
            time: record.checkInTime,
            latitude: record.checkInLatitude,
            longitude: record.checkInLongitude,
            place: record.checkInPlace,
            status: record.status,
            lateMinutes: record.lateMinutes,
            deductionAmount: record.deductionAmount,
          }
        : null,
      checkOut: record.checkOutTime
        ? {
            time: record.checkOutTime,
            latitude: record.checkOutLatitude,
            longitude: record.checkOutLongitude,
            place: record.checkOutPlace,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getAttendanceLogs(req, res) {
  try {
    const teacher = await findTeacherForUser(req.user);
    if (!teacher) {
      return res.status(403).json({ message: "No teacher profile found" });
    }

    const todayStr = getTodayString();
    const requestedMonth = req.query.month || todayStr.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) {
      return res.status(400).json({ message: "Month must use YYYY-MM format" });
    }

    const [year, month] = requestedMonth.split("-").map(Number);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    const [currY, currM, currD] = todayStr.split("-").map(Number);
    const currentDay = new Date(currY, currM - 1, currD);
    const effectiveEnd = monthEnd < currentDay ? monthEnd : currentDay;
    const settings = (await SchoolSettings.findOne()) || {};
    const records = await TeacherAttendance.find({
      teacherId: teacher._id,
      date: {
        $gte: `${requestedMonth}-01`,
        $lte: `${requestedMonth}-${String(monthEnd.getDate()).padStart(2, "0")}`,
      },
    }).sort({ date: 1 });
    const recordsByDate = new Map(records.map((record) => [record.date, record]));
    const logs = [];

    if (monthStart <= currentDay) {
      for (let day = 1; day <= effectiveEnd.getDate(); day += 1) {
        const date = new Date(year, month - 1, day, 12, 0, 0);
        if (!isWorkingDay(settings, date)) continue;

        const dateString = `${requestedMonth}-${String(day).padStart(2, "0")}`;
        const record = recordsByDate.get(dateString);
        logs.push({
          id: record?._id || null,
          date: dateString,
          status: record?.status || "absent",
          checkInTime: record?.checkInTime || null,
          checkOutTime: record?.checkOutTime || null,
          lateMinutes: record?.lateMinutes || 0,
          isSynthetic: !record,
        });
      }
    }

    const count = (status) => logs.filter((log) => log.status === status).length;
    const presentDays = count("present");
    const lateDays = count("late");
    const halfDays = count("half_day");
    const absentDays = count("absent");
    const leaveDays = count("leave");
    const workingDays = logs.length;
    const attendanceEquivalent = presentDays + lateDays + halfDays * 0.5;
    const attendancePercent = workingDays > 0
      ? Math.round((attendanceEquivalent / workingDays) * 100)
      : 0;

    res.json({
      month: requestedMonth,
      summary: {
        attendancePercent,
        workingDays,
        presentDays,
        lateDays,
        halfDays,
        absentDays,
        leaveDays,
      },
      logs,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function checkIn(req, res) {
  try {
    const teacher = await findTeacherForUser(req.user);
    if (!teacher) {
      return res.status(403).json({ message: "No teacher profile found" });
    }

    const todayStr = getTodayString();
    const { time, latitude, longitude, place } = req.body;
    const settings = (await SchoolSettings.findOne()) || {};
    const salaryConfig = settings.salaryConfig || {};

    const checkInDate = time ? new Date(time) : new Date();
    const dayName = getDayName(checkInDate);
    if (!isWorkingDay(settings, checkInDate)) {
      return res.status(400).json({
        message: `Check-in blocked: Today (${dayName}) is a non-working day according to school settings.`,
        isWorkingDay: false,
      });
    }

    const schoolLat = salaryConfig.schoolLatitude || 28.6139;
    const schoolLng = salaryConfig.schoolLongitude || 77.2090;
    const maxRadius = salaryConfig.allowedRadiusMeters || 50;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: "Location coordinates are required to check in." });
    }

    // Calculate distance from school coordinates
    const distanceFromSchool = getDistanceFromLatLonInMeters(schoolLat, schoolLng, Number(latitude), Number(longitude));
    if (distanceFromSchool > maxRadius) {
      return res.status(400).json({
        message: `Check-in blocked: You are outside the school boundary (${distanceFromSchool}m away; maximum allowed radius is ${maxRadius}m).`,
        distance: distanceFromSchool,
        allowedRadius: maxRadius,
      });
    }

    // Check Late status based on schoolStartTime + lateGraceMinutes in Asia/Kolkata
    const startTimeStr = salaryConfig.schoolStartTime || "08:30"; // "HH:mm"
    const [startH, startM] = startTimeStr.split(":").map(Number);
    const graceM = salaryConfig.lateGraceMinutes || 10;

    const deadlineTotalMinutes = (startH || 8) * 60 + (startM || 30) + graceM;
    const istParts = getISTParts(checkInDate);
    const checkInTotalMinutes = istParts.hour * 60 + istParts.minute;

    let status = "present";
    let lateMinutes = 0;
    let deductionAmount = 0;

    if (checkInTotalMinutes > deadlineTotalMinutes) {
      status = "late";
      lateMinutes = checkInTotalMinutes - deadlineTotalMinutes;

      const monthStart = `${todayStr.slice(0, 7)}-01`;
      const previousLateDays = await TeacherAttendance.countDocuments({
        teacherId: teacher._id,
        date: { $gte: monthStart, $lt: todayStr },
        lateMinutes: { $gt: 0 },
      });
      const lateDaysPerHalfDay = Math.max(1, salaryConfig.lateDaysPerHalfDay || 3);
      if ((previousLateDays + 1) % lateDaysPerHalfDay === 0) {
        status = "half_day";
        const deductionType = salaryConfig.halfDayDeductionType || "percentage";
        const deductionValue = salaryConfig.halfDayDeductionValue ?? salaryConfig.lateDeductionPercent ?? 50;
        if (deductionType === "fixed") {
          deductionAmount = Math.round(Math.max(0, deductionValue));
        } else {
          const monthlySalary = teacher.monthlySalary || 0;
          const workingDaysCount = (settings.workingDays || []).length * 4 || 20;
          const oneDaySalary = workingDaysCount > 0 ? monthlySalary / workingDaysCount : 0;
          deductionAmount = Math.round(oneDaySalary * (Math.min(100, Math.max(0, deductionValue)) / 100));
        }
      }
    }

    const record = await TeacherAttendance.findOneAndUpdate(
      { teacherId: teacher._id, date: todayStr },
      {
        $set: {
          checkInTime: checkInDate,
          checkInLatitude: latitude,
          checkInLongitude: longitude,
          checkInPlace: place || "",
          status,
          lateMinutes,
          deductionAmount,
          distanceFromSchoolMeters: distanceFromSchool,
        },
      },
      { new: true, upsert: true }
    );

    res.status(200).json({
      message: status === "half_day"
        ? `Checked in late by ${lateMinutes} mins; this late occurrence is marked as a half-day`
        : status === "late"
          ? `Checked in (Late by ${lateMinutes} mins)`
          : "Check-in successful",
      record,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function checkOut(req, res) {
  try {
    const teacher = await findTeacherForUser(req.user);
    if (!teacher) {
      return res.status(403).json({ message: "No teacher profile found" });
    }

    const todayStr = getTodayString();
    const { time, latitude, longitude, place } = req.body;
    const settings = (await SchoolSettings.findOne()) || {};
    const salaryConfig = settings.salaryConfig || {};

    const checkOutDate = time ? new Date(time) : new Date();
    const dayName = getDayName(checkOutDate);
    if (!isWorkingDay(settings, checkOutDate)) {
      return res.status(400).json({
        message: `Check-out blocked: Today (${dayName}) is a non-working day according to school settings.`,
        isWorkingDay: false,
      });
    }

    const schoolLat = salaryConfig.schoolLatitude || 28.6139;
    const schoolLng = salaryConfig.schoolLongitude || 77.2090;
    const maxRadius = salaryConfig.allowedRadiusMeters || 50;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: "Location coordinates are required to check out." });
    }

    const distanceFromSchool = getDistanceFromLatLonInMeters(schoolLat, schoolLng, Number(latitude), Number(longitude));
    if (distanceFromSchool > maxRadius) {
      return res.status(400).json({
        message: `Check-out blocked: You are outside the school boundary (${distanceFromSchool}m away; maximum allowed radius is ${maxRadius}m).`,
        distance: distanceFromSchool,
        allowedRadius: maxRadius,
      });
    }

    const record = await TeacherAttendance.findOneAndUpdate(
      { teacherId: teacher._id, date: todayStr },
      {
        $set: {
          checkOutTime: checkOutDate,
          checkOutLatitude: latitude,
          checkOutLongitude: longitude,
          checkOutPlace: place || "",
        },
      },
      { new: true, upsert: true }
    );

    res.status(200).json({
      message: "Check-out recorded",
      record,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = {
  getCheckStatus,
  getAttendanceLogs,
  checkIn,
  checkOut,
};
