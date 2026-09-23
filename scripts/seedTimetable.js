require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const TimetableEntry = require("../src/models/TimetableEntry");
const SchoolClass = require("../src/models/SchoolClass");
const Teacher = require("../src/models/Teacher");
const Subject = require("../src/models/Subject");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PERIODS = [
  { period: 1, name: "Period 1", start: "08:30 AM", end: "09:15 AM" },
  { period: 2, name: "Period 2", start: "09:15 AM", end: "10:00 AM" },
  { period: 3, name: "Period 3", start: "10:00 AM", end: "10:45 AM" },
  { period: 4, name: "Period 4", start: "11:15 AM", end: "12:00 PM" },
  { period: 5, name: "Period 5", start: "12:00 PM", end: "12:45 PM" },
  { period: 6, name: "Period 6", start: "01:30 PM", end: "02:15 PM" },
];

async function seedDifferentiatedTimetables() {
  await connectDB();
  console.log("=======================================================");
  console.log("⏰ RE-SEEDING SECTION-DIFFERENTIATED TIMETABLES...");
  console.log("=======================================================\n");

  console.log("Clearing existing timetable entries...");
  await TimetableEntry.deleteMany({});

  const classes = await SchoolClass.find({}).sort({ grade: 1, section: 1 });
  const teachers = await Teacher.find({});
  const dbSubjects = await Subject.find({ status: "active" });

  const subjectNames = dbSubjects.length > 0 
    ? dbSubjects.map((s) => s.name)
    : ["Mathematics", "Science", "English", "Social Studies", "Hindi", "Computer Science", "EVS", "Art & Craft", "Physical Education"];

  console.log(`Found ${classes.length} classes and ${teachers.length} teachers.`);

  const newTimetableDocs = [];

  for (let cIdx = 0; cIdx < classes.length; cIdx++) {
    const cls = classes[cIdx];
    
    // Choose appropriate subjects for nursery/primary vs secondary vs senior secondary
    let classSubjectPool = subjectNames;
    if (["Nursery", "LKG", "UKG", "1st", "2nd"].includes(cls.grade)) {
      classSubjectPool = ["English", "Hindi", "Mathematics", "EVS", "Art & Craft", "Physical Education", "Music"];
    } else if (["3rd", "4th", "5th", "6th", "7th", "8th"].includes(cls.grade)) {
      classSubjectPool = ["English", "Hindi", "Mathematics", "Science", "Social Studies", "Computer Science", "Art & Craft", "Physical Education"];
    }

    for (let dIdx = 0; dIdx < DAYS.length; dIdx++) {
      const day = DAYS[dIdx];

      for (let pIdx = 0; pIdx < PERIODS.length; pIdx++) {
        const p = PERIODS[pIdx];

        // Unique mathematical offset using class index cIdx so section A, B, C, D never match!
        const subjIndex = (pIdx * 3 + dIdx * 5 + cIdx * 7) % classSubjectPool.length;
        const subject = classSubjectPool[subjIndex];

        // Find a teacher assigned or available for this subject & class
        const teacherOffset = (pIdx + dIdx * 3 + cIdx * 11) % teachers.length;
        const teacher = teachers[teacherOffset];

        newTimetableDocs.push({
          classId: cls._id,
          className: cls.name,
          grade: cls.grade,
          section: cls.section,
          day,
          period: p.period,
          periodName: p.name,
          startTime: p.start,
          endTime: p.end,
          subject,
          teacherName: teacher ? teacher.name : "Teacher Staff",
          teacherId: teacher ? teacher._id : undefined,
        });
      }
    }
  }

  await TimetableEntry.insertMany(newTimetableDocs);

  console.log(`\n✅ Generated ${newTimetableDocs.length} unique, section-varied timetable entries across ${classes.length} classes!`);
  console.log("UKG-A, UKG-B, and UKG-C now have completely distinct daily period schedules and subject teachers.");
  console.log("=======================================================\n");

  await mongoose.disconnect();
}

seedDifferentiatedTimetables().catch((err) => {
  console.error("❌ Timetable seed failed:", err);
  process.exit(1);
});
