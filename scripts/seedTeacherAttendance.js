require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Teacher = require("../src/models/Teacher");
const TeacherAttendance = require("../src/models/TeacherAttendance");
const SchoolSettings = require("../src/models/SchoolSettings");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatDateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seedTeacherAttendance() {
  await connectDB();
  console.log("Seeding teacher attendance data...");

  const teachers = await Teacher.find({ status: { $ne: "inactive" } });
  console.log(`Found ${teachers.length} active teachers.`);

  if (teachers.length === 0) {
    console.log("No teachers found. Please run main seed script first.");
    process.exit(1);
  }

  const settings = (await SchoolSettings.findOne()) || {};
  const salaryConfig = settings.salaryConfig || {};
  const schoolLat = salaryConfig.schoolLatitude || 28.6139;
  const schoolLng = salaryConfig.schoolLongitude || 77.2090;
  const workingDays = settings.workingDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Clear existing teacher attendance
  await TeacherAttendance.deleteMany({});
  console.log("Cleared existing teacher attendance records.");

  const attendanceDocs = [];
  const today = new Date();

  // Generate attendance for the past 30 days
  for (let i = 30; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);

    const dayName = DAY_NAMES[d.getDay()];
    // Skip non-working days
    if (!workingDays.some((w) => w.toLowerCase() === dayName.toLowerCase())) {
      continue;
    }

    const dateStr = formatDateString(d);

    for (const teacher of teachers) {
      const roll = Math.random();
      let status = "present";
      let lateMinutes = 0;
      let deductionAmount = 0;

      let checkInTime = null;
      let checkOutTime = null;
      let checkInLat = null;
      let checkInLng = null;
      let checkOutLat = null;
      let checkOutLng = null;
      let distanceFromSchool = 0;

      if (roll < 0.80) {
        // 80% Present (On Time)
        status = "present";
        checkInTime = new Date(d);
        checkInTime.setHours(8, randomInt(15, 29), 0, 0); // 8:15 AM - 8:29 AM

        checkOutTime = new Date(d);
        checkOutTime.setHours(15, randomInt(30, 45), 0, 0); // 3:30 PM - 3:45 PM

        // Coordinates within 10-40 meters
        const latOffset = (Math.random() - 0.5) * 0.0003;
        const lngOffset = (Math.random() - 0.5) * 0.0003;
        checkInLat = schoolLat + latOffset;
        checkInLng = schoolLng + lngOffset;
        checkOutLat = schoolLat + latOffset;
        checkOutLng = schoolLng + lngOffset;
        distanceFromSchool = randomInt(12, 38);
      } else if (roll < 0.92) {
        // 12% Late
        status = "late";
        lateMinutes = randomInt(12, 40);
        checkInTime = new Date(d);
        checkInTime.setHours(8, 45 + lateMinutes, 0, 0); // After 8:45 AM

        checkOutTime = new Date(d);
        checkOutTime.setHours(15, randomInt(30, 45), 0, 0);

        const latOffset = (Math.random() - 0.5) * 0.0004;
        const lngOffset = (Math.random() - 0.5) * 0.0004;
        checkInLat = schoolLat + latOffset;
        checkInLng = schoolLng + lngOffset;
        checkOutLat = schoolLat + latOffset;
        checkOutLng = schoolLng + lngOffset;
        distanceFromSchool = randomInt(15, 45);

        // Deduct 50% daily salary for late attendance
        const monthlySalary = teacher.monthlySalary || 45000;
        const oneDaySalary = monthlySalary / 24;
        deductionAmount = Math.round(oneDaySalary * 0.5);
      } else if (roll < 0.96) {
        // 4% Leave
        status = "leave";
      } else {
        // 4% Absent
        status = "absent";
      }

      attendanceDocs.push({
        teacherId: teacher._id,
        date: dateStr,
        checkInTime,
        checkInLatitude: checkInLat,
        checkInLongitude: checkInLng,
        checkInPlace: checkInTime ? "Main School Gate" : undefined,
        checkOutTime,
        checkOutLatitude: checkOutLat,
        checkOutLongitude: checkOutLng,
        checkOutPlace: checkOutTime ? "Main School Gate" : undefined,
        status,
        lateMinutes,
        deductionAmount,
        distanceFromSchoolMeters: distanceFromSchool,
      });
    }
  }

  console.log(`Inserting ${attendanceDocs.length} teacher attendance records...`);
  await TeacherAttendance.insertMany(attendanceDocs);

  console.log("✅ Teacher attendance data seeded successfully!");
  await mongoose.disconnect();
}

seedTeacherAttendance().catch((err) => {
  console.error("❌ Teacher attendance seed failed:", err);
  process.exit(1);
});
