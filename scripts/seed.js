require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const { gradeBandFor } = require("../src/utils/gradeBands");

const User = require("../src/models/User");
const Student = require("../src/models/Student");
const Teacher = require("../src/models/Teacher");
const TeacherAttendance = require("../src/models/TeacherAttendance");
const SchoolClass = require("../src/models/SchoolClass");
const Attendance = require("../src/models/Attendance");
const AttendanceRecord = require("../src/models/AttendanceRecord");
const FeeRecord = require("../src/models/FeeRecord");
const Announcement = require("../src/models/Announcement");
const ClassDiary = require("../src/models/ClassDiary");
const TimetableEntry = require("../src/models/TimetableEntry");
const Exam = require("../src/models/Exam");
const ExamResult = require("../src/models/ExamResult");
const SchoolSettings = require("../src/models/SchoolSettings");

const FIRST_NAMES = [
  "Aarav", "Vihaan", "Aditya", "Vivaan", "Arjun", "Reyansh", "Ayaan", "Krishna",
  "Ishaan", "Kabir", "Ananya", "Diya", "Saanvi", "Aadhya", "Myra", "Anaya",
  "Pari", "Riya", "Kiara", "Navya", "Rohan", "Karan", "Yash", "Devansh",
  "Sai", "Aryan", "Advait", "Dhruv", "Neha", "Priya", "Sanya", "Meera",
  "Tanvi", "Ishita", "Rudra", "Vedant", "Om", "Shaurya", "Atharv", "Kavya",
  "Pooja", "Rahul", "Siddharth", "Vikram", "Sneha", "Rajesh", "Sunita", "Amit",
];

const LAST_NAMES = [
  "Sharma", "Patel", "Mehta", "Gupta", "Singh", "Verma", "Reddy", "Nair",
  "Iyer", "Kapoor", "Malhotra", "Chopra", "Bhatt", "Joshi", "Rao", "Kulkarni",
  "Agarwal", "Bose", "Chatterjee", "Desai", "Mishra", "Pandey", "Saxena",
];

const BAND_PREFIXES = [
  { label: "Nursery - 5th", count: 320, ageRange: [3, 11], classPrefixes: ["Nursery", "LKG", "UKG", "1st", "2nd", "3rd", "4th", "5th"] },
  { label: "6th - 8th", count: 312, ageRange: [11, 14], classPrefixes: ["6th", "7th", "8th"] },
  { label: "9th - 10th", count: 298, ageRange: [14, 16], classPrefixes: ["9th", "10th"] },
  { label: "11th - 12th", count: 318, ageRange: [16, 18], classPrefixes: ["11th", "12th"] },
];

const SECTIONS = ["A", "B", "C", "D"];
const SUBJECTS = [
  "Mathematics", "Science", "English", "Social Studies", "Hindi", "Computer Science",
  "Physics", "Chemistry", "Biology", "Physical Education", "Art", "Music",
];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const STREETS = [
  "MG Road", "Park Street", "Church Street", "Residency Road", "Brigade Road",
  "Anna Nagar", "Koramangala 4th Block", "Salt Lake Sector 5", "Jubilee Hills", "Banjara Hills",
];
const CITIES = ["Bengaluru", "Mumbai", "Delhi", "Kolkata", "Hyderabad", "Chennai", "Pune", "Ahmedabad"];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomPhone() {
  return `${randomItem(["6", "7", "8", "9"])}${randomInt(100000000, 999999999)}`;
}
function randomAddress() {
  return `${randomInt(1, 200)}, ${randomItem(STREETS)}, ${randomItem(CITIES)}`;
}
function dobForAgeRange([minAge, maxAge]) {
  const ageDays = randomInt(minAge * 365, maxAge * 365);
  return new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
}
function randomAdmissionDate() {
  return new Date(Date.now() - randomInt(30, 5 * 365) * 24 * 60 * 60 * 1000);
}
function formatDateString(d) {
  const now = d ? new Date(d) : new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function seed() {
  await connectDB();

  console.log("Clearing existing collections...");
  await Promise.all([
    User.deleteMany({}),
    Student.deleteMany({}),
    Teacher.deleteMany({}),
    TeacherAttendance.deleteMany({}),
    SchoolClass.deleteMany({}),
    Attendance.deleteMany({}),
    AttendanceRecord.deleteMany({}),
    FeeRecord.deleteMany({}),
    Announcement.deleteMany({}),
    ClassDiary.deleteMany({}),
    TimetableEntry.deleteMany({}),
    Exam.deleteMany({}),
    ExamResult.deleteMany({}),
    SchoolSettings.deleteMany({}),
  ]);

  // --- 1. School Settings ---
  console.log("Seeding school settings...");
  await SchoolSettings.create({
    schoolName: "Schoolo International Academy",
    address: "123 Education Boulevard, Tech City",
    contactEmail: "info@schoolo.edu",
    contactPhone: "9876543210",
    academicYear: "2026-2027",
    terms: ["Term 1", "Term 2"],
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    lecturePeriods: [
      { periodNo: 1, name: "Period 1", startTime: "08:30 AM", endTime: "09:15 AM", durationMinutes: 45, isBreak: false },
      { periodNo: 2, name: "Period 2", startTime: "09:15 AM", endTime: "10:00 AM", durationMinutes: 45, isBreak: false },
      { periodNo: 3, name: "Period 3", startTime: "10:00 AM", endTime: "10:45 AM", durationMinutes: 45, isBreak: false },
      { periodNo: 4, name: "Break", startTime: "10:45 AM", endTime: "11:15 AM", durationMinutes: 30, isBreak: true },
      { periodNo: 5, name: "Period 4", startTime: "11:15 AM", endTime: "12:00 PM", durationMinutes: 45, isBreak: false },
      { periodNo: 6, name: "Period 5", startTime: "12:00 PM", endTime: "12:45 PM", durationMinutes: 45, isBreak: false },
      { periodNo: 7, name: "Lunch", startTime: "12:45 PM", endTime: "01:30 PM", durationMinutes: 45, isBreak: true },
      { periodNo: 8, name: "Period 6", startTime: "01:30 PM", endTime: "02:15 PM", durationMinutes: 45, isBreak: false },
    ],
    salaryConfig: {
      schoolStartTime: "08:30",
      schoolEndTime: "15:30",
      lateGraceMinutes: 15,
      schoolLatitude: 28.6139,
      schoolLongitude: 77.2090,
      allowedRadiusMeters: 100,
      lateDeductionPercent: 50,
    },
  });

  // --- 2. Classes (48 total) ---
  console.log("Seeding classes...");
  const classDocs = [];
  const allPrefixes = BAND_PREFIXES.flatMap((band) => band.classPrefixes);
  let classesRemaining = 48;
  for (const prefix of allPrefixes) {
    if (classesRemaining <= 0) break;
    const sectionsForThisGrade = Math.min(
      SECTIONS.length,
      Math.max(1, Math.round(classesRemaining / (allPrefixes.length - allPrefixes.indexOf(prefix))))
    );
    for (let i = 0; i < sectionsForThisGrade && classesRemaining > 0; i++) {
      classDocs.push({
        name: `${prefix}-${SECTIONS[i]}`,
        grade: prefix,
        section: SECTIONS[i],
        gradeBand: gradeBandFor(prefix),
        studentCount: 0,
      });
      classesRemaining--;
    }
  }
  const classes = await SchoolClass.insertMany(classDocs);

  // --- 3. Teachers & User Accounts (30 Teachers with Login Credentials) ---
  console.log("Seeding teachers and user accounts...");
  const teacherPasswordHash = await bcrypt.hash("Teacher@123", 10);
  const teacherDocs = [];
  
  // Specific teacher sample logins for quick testing
  const sampleTeacherProfiles = [
    { name: "Anita Sharma", email: "teacher@example.com", subject: "Mathematics", targetClass: "10th-A" },
    { name: "Rajesh Kumar", email: "teacher2@example.com", subject: "Science", targetClass: "9th-B" },
    { name: "Sunita Verma", email: "teacher3@example.com", subject: "English", targetClass: "8th-A" },
    { name: "Vikram Malhotra", email: "teacher4@example.com", subject: "Social Studies", targetClass: "10th-B" },
    { name: "Sneha Reddy", email: "teacher5@example.com", subject: "Computer Science", targetClass: "11th-A" },
  ];

  for (let i = 0; i < 30; i++) {
    const profile = sampleTeacherProfiles[i] || {
      name: `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`,
      email: `teacher${i + 1}@school.com`,
      subject: randomItem(SUBJECTS),
      targetClass: randomItem(classes).name,
    };

    const user = await User.create({
      name: profile.name,
      email: profile.email.toLowerCase(),
      passwordHash: teacherPasswordHash,
      role: "teacher",
      phone: randomPhone(),
    });

    const nameParts = profile.name.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || "Teacher";

    teacherDocs.push({
      userId: user._id,
      name: profile.name,
      firstName,
      lastName,
      email: profile.email.toLowerCase(),
      phone: user.phone,
      subject: profile.subject,
      classAssigned: profile.targetClass,
      monthlySalary: randomInt(35000, 65000),
      status: "active",
      joinDate: new Date(Date.now() - randomInt(60, 1500) * 24 * 60 * 60 * 1000),
      assignments: [],
    });
  }

  const teachers = await Teacher.insertMany(teacherDocs);

  // Assign class teachers and subject assignments across all classes
  console.log("Linking class teachers and subject assignments...");
  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i];
    const assignedTeacher = teachers[i % teachers.length];

    // Set as class teacher
    await SchoolClass.updateOne({ _id: cls._id }, { classTeacherId: assignedTeacher._id });

    // Assign 3-4 subjects to teachers
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const subj = SUBJECTS[(i + sIdx) % SUBJECTS.length];
      const t = teachers[(i + sIdx) % teachers.length];
      await Teacher.updateOne(
        { _id: t._id },
        { $push: { assignments: { classId: cls._id, subject: subj } } }
      );
    }
  }

  // --- 4. Students (1248 total, matching grade band counts) ---
  console.log("Seeding students...");
  const studentDocs = [];
  let admissionCounter = 1000;
  for (const band of BAND_PREFIXES) {
    const classesInBand = classes.filter((c) => band.classPrefixes.includes(c.grade));
    for (let i = 0; i < band.count; i++) {
      const cls = randomItem(classesInBand);
      const gender = randomItem(["Male", "Female"]);
      const fatherName = `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`;
      const motherName = `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`;
      studentDocs.push({
        name: `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`,
        admissionNo: `ADM${admissionCounter++}`,
        classId: cls._id,
        rollNo: randomInt(1, 50),
        gender,
        dateOfBirth: dobForAgeRange(band.ageRange),
        bloodGroup: Math.random() < 0.8 ? randomItem(BLOOD_GROUPS) : undefined,
        address: randomAddress(),
        fatherName,
        fatherPhone: randomPhone(),
        motherName,
        motherPhone: randomPhone(),
        emergencyContactName: fatherName,
        emergencyContactPhone: randomPhone(),
        admissionDate: randomAdmissionDate(),
        status: Math.random() < 0.97 ? "active" : "inactive",
        attendancePercent: randomInt(75, 99),
        performancePercent: randomInt(60, 92),
      });
    }
  }
  const students = await Student.insertMany(studentDocs);

  // Update class student counts
  const countByClass = {};
  for (const s of students) {
    const key = s.classId.toString();
    countByClass[key] = (countByClass[key] || 0) + 1;
  }
  await Promise.all(
    classes.map((c) =>
      SchoolClass.updateOne({ _id: c._id }, { studentCount: countByClass[c._id.toString()] || 0 })
    )
  );

  // Pin a handful of well-known top performers
  const classByName = Object.fromEntries(classes.map((c) => [c.name, c]));
  const topPerformerSeeds = [
    { name: "Aarav Sharma", className: "10th-A", performancePercent: 96.4 },
    { name: "Diya Patel", className: "9th-B", performancePercent: 94.2 },
    { name: "Vihaan Mehta", className: "8th-A", performancePercent: 93.1 },
    { name: "Ananya Gupta", className: "10th-B", performancePercent: 92.5 },
    { name: "Reyansh Singh", className: "9th-A", performancePercent: 91.8 },
  ];
  const topPerformers = [];
  for (const seedStudent of topPerformerSeeds) {
    const cls = classByName[seedStudent.className];
    const band = BAND_PREFIXES.find((b) => b.classPrefixes.includes(cls.grade));
    const fatherName = `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`;
    const created = await Student.create({
      name: seedStudent.name,
      admissionNo: `ADM${admissionCounter++}`,
      classId: cls._id,
      rollNo: randomInt(1, 50),
      gender: randomItem(["Male", "Female"]),
      dateOfBirth: dobForAgeRange(band.ageRange),
      bloodGroup: randomItem(BLOOD_GROUPS),
      address: randomAddress(),
      fatherName,
      fatherPhone: randomPhone(),
      motherName: `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`,
      motherPhone: randomPhone(),
      emergencyContactName: fatherName,
      emergencyContactPhone: randomPhone(),
      admissionDate: randomAdmissionDate(),
      status: "active",
      attendancePercent: randomInt(94, 99),
      performancePercent: seedStudent.performancePercent,
    });
    topPerformers.push(created);
    await SchoolClass.updateOne({ _id: cls._id }, { $inc: { studentCount: 1 } });
  }

  // --- 5. Sibling Links (~30 student pairs linked both ways) ---
  console.log("Seeding sibling links...");
  const allStudents = [...students, ...topPerformers];
  for (let i = 0; i < 30; i++) {
    const a = randomItem(allStudents);
    const b = randomItem(allStudents);
    if (a._id.equals(b._id)) continue;
    await Student.updateOne({ _id: a._id }, { $addToSet: { siblingIds: b._id } });
    await Student.updateOne({ _id: b._id }, { $addToSet: { siblingIds: a._id } });
  }

  // --- 6. Attendance Records ---
  console.log("Seeding daily attendance records...");
  const today = new Date();
  const targetClasses = classes.slice(0, 10);
  const attendanceRecordDocs = [];
  for (const cls of targetClasses) {
    const classStudents = allStudents.filter((s) => s.classId.equals(cls._id));
    for (const student of classStudents) {
      const statusRoll = Math.random();
      let status = "present";
      if (statusRoll < 0.82) status = "present";
      else if (statusRoll < 0.90) status = "absent";
      else if (statusRoll < 0.94) status = "late";
      else if (statusRoll < 0.97) status = "leave";
      else status = "half_day";

      attendanceRecordDocs.push({
        classId: cls._id,
        studentId: student._id,
        date: today,
        status,
        lateTime: status === "late" ? "08:45 AM" : "",
      });
    }
  }
  await AttendanceRecord.insertMany(attendanceRecordDocs);

  // Overall weekly attendance summary
  const weekPattern = [
    { day: "Mon", presentPercent: 91, absentPercent: 9 },
    { day: "Tue", presentPercent: 88, absentPercent: 12 },
    { day: "Wed", presentPercent: 93, absentPercent: 7 },
    { day: "Thu", presentPercent: 90, absentPercent: 10 },
    { day: "Fri", presentPercent: 84, absentPercent: 16 },
    { day: "Sat", presentPercent: 92, absentPercent: 8 },
    { day: "Sun", presentPercent: 0, absentPercent: 0 },
  ];
  const monday = new Date();
  monday.setDate(monday.getDate() - monday.getDay() + 1);
  await Attendance.insertMany(
    weekPattern.map((entry, index) => ({
      date: new Date(monday.getTime() + index * 24 * 60 * 60 * 1000),
      day: entry.day,
      presentPercent: entry.presentPercent,
      absentPercent: entry.absentPercent,
    }))
  );

  // --- 6b. Teacher Attendance Records (Past 30 Days) ---
  console.log("Seeding teacher attendance records...");
  const teacherAttDocs = [];
  const DAY_NAMES_LIST = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const workingDaysList = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const schoolLat = 28.6139;
  const schoolLng = 77.2090;

  for (let dOff = 30; dOff >= 0; dOff--) {
    const d = new Date(today);
    d.setDate(d.getDate() - dOff);
    const dayName = DAY_NAMES_LIST[d.getDay()];
    if (!workingDaysList.includes(dayName)) continue;

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
        status = "present";
        checkInTime = new Date(d);
        checkInTime.setHours(8, randomInt(15, 29), 0, 0);

        checkOutTime = new Date(d);
        checkOutTime.setHours(15, randomInt(30, 45), 0, 0);

        const latOffset = (Math.random() - 0.5) * 0.0003;
        const lngOffset = (Math.random() - 0.5) * 0.0003;
        checkInLat = schoolLat + latOffset;
        checkInLng = schoolLng + lngOffset;
        checkOutLat = schoolLat + latOffset;
        checkOutLng = schoolLng + lngOffset;
        distanceFromSchool = randomInt(12, 38);
      } else if (roll < 0.92) {
        status = "late";
        lateMinutes = randomInt(12, 40);
        checkInTime = new Date(d);
        checkInTime.setHours(8, 45 + lateMinutes, 0, 0);

        checkOutTime = new Date(d);
        checkOutTime.setHours(15, randomInt(30, 45), 0, 0);

        const latOffset = (Math.random() - 0.5) * 0.0004;
        const lngOffset = (Math.random() - 0.5) * 0.0004;
        checkInLat = schoolLat + latOffset;
        checkInLng = schoolLng + lngOffset;
        checkOutLat = schoolLat + latOffset;
        checkOutLng = schoolLng + lngOffset;
        distanceFromSchool = randomInt(15, 45);

        const monthlySalary = teacher.monthlySalary || 45000;
        const oneDaySalary = monthlySalary / 24;
        deductionAmount = Math.round(oneDaySalary * 0.5);
      } else if (roll < 0.96) {
        status = "leave";
      } else {
        status = "absent";
      }

      teacherAttDocs.push({
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
  await TeacherAttendance.insertMany(teacherAttDocs);

  // --- 7. Daily Class Diary Entries (ClassLog) ---
  console.log("Seeding daily class diary entries...");
  const diaryDocs = [];
  const todayStr = formatDateString();
  const sampleTopics = [
    { subject: "Mathematics", topic: "Chapter 4: Quadratic Equations & Formulae", cw: "Exercise 4.2 Q1-Q8 solved in class", hw: "Complete Ex 4.2 Q9-Q15 in HW notebook" },
    { subject: "Science", topic: "Chapter 6: Life Processes & Photosynthesis", cw: "Diagram of Chloroplast drawn and labeled", hw: "Write short note on Light Reaction" },
    { subject: "English", topic: "Unit 3: The Road Not Taken (Poem)", cw: "Stanza analysis & word meanings discussed", hw: "Answer Q1 to Q4 from textbook page 42" },
    { subject: "Social Studies", topic: "Chapter 2: Nationalism in India", cw: "Non-Cooperation Movement timeline notes", hw: "Prepare 5 short questions on Dandi March" },
    { subject: "Computer Science", topic: "Introduction to Data Structures & Arrays", cw: "Implemented Array traversal program in C++", hw: "Write program for Binary Search" },
  ];

  for (const cls of classes.slice(0, 12)) {
    for (const t of sampleTopics) {
      const teacher = teachers.find((tr) => tr.subject === t.subject) || teachers[0];
      diaryDocs.push({
        classId: cls._id,
        subject: t.subject,
        teacherId: teacher._id,
        teacherName: teacher.name,
        date: todayStr,
        topicTaught: t.topic,
        classwork: t.cw,
        homework: t.hw,
        remarks: "Students participated actively during class discussion.",
      });
    }
  }
  await ClassDiary.insertMany(diaryDocs);

  // --- 8. Timetable Entries ---
  console.log("Seeding timetable entries...");
  const timetableDocs = [];
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const periods = [
    { period: 1, name: "Period 1", start: "08:30 AM", end: "09:15 AM" },
    { period: 2, name: "Period 2", start: "09:15 AM", end: "10:00 AM" },
    { period: 3, name: "Period 3", start: "10:00 AM", end: "10:45 AM" },
    { period: 4, name: "Period 4", start: "11:15 AM", end: "12:00 PM" },
    { period: 5, name: "Period 5", start: "12:00 PM", end: "12:45 PM" },
    { period: 6, name: "Period 6", start: "01:30 PM", end: "02:15 PM" },
  ];

  for (let cIdx = 0; cIdx < classes.length; cIdx++) {
    const cls = classes[cIdx];
    let classSubjectPool = SUBJECTS;
    if (["Nursery", "LKG", "UKG", "1st", "2nd"].includes(cls.grade)) {
      classSubjectPool = ["English", "Hindi", "Mathematics", "EVS", "Art & Craft", "Physical Education", "Music"];
    } else if (["3rd", "4th", "5th", "6th", "7th", "8th"].includes(cls.grade)) {
      classSubjectPool = ["English", "Hindi", "Mathematics", "Science", "Social Studies", "Computer Science", "Art & Craft", "Physical Education"];
    }

    for (let dIdx = 0; dIdx < days.length; dIdx++) {
      const day = days[dIdx];
      for (let pIdx = 0; pIdx < periods.length; pIdx++) {
        const p = periods[pIdx];
        const subjIndex = (pIdx * 3 + dIdx * 5 + cIdx * 7) % classSubjectPool.length;
        const subject = classSubjectPool[subjIndex];

        const teacherOffset = (pIdx + dIdx * 3 + cIdx * 11) % teachers.length;
        const teacher = teachers[teacherOffset];

        timetableDocs.push({
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
  await TimetableEntry.insertMany(timetableDocs);

  // --- 9. Exams & Exam Results ---
  console.log("Seeding exams & student results...");
  const examDocs = [];
  const examResultDocs = [];
  const examSubjects = ["Mathematics", "Science", "English", "Social Studies"];

  for (const cls of classes.slice(0, 8)) {
    for (const subj of examSubjects) {
      const exam = await Exam.create({
        name: `Mid-Term Examination 2026`,
        subject: subj,
        classId: cls._id,
        examDate: new Date(Date.now() - randomInt(5, 20) * 24 * 60 * 60 * 1000),
        totalMarks: 100,
        status: "active",
      });
      examDocs.push(exam);

      const classStudents = allStudents.filter((s) => s.classId.equals(cls._id));
      for (const student of classStudents) {
        const marks = randomInt(45, 98);
        examResultDocs.push({
          examId: exam._id,
          studentId: student._id,
          marksObtained: marks,
          remarks: marks >= 90 ? "Outstanding" : marks >= 75 ? "Very Good" : marks >= 50 ? "Good" : "Needs Improvement",
        });
      }
    }
  }
  await ExamResult.insertMany(examResultDocs);

  // --- 10. Fee Records ---
  console.log("Seeding fee records...");
  const feeDocs = [];
  const currentMonth = new Date().toLocaleString("en-IN", { month: "long", year: "numeric" });
  for (let i = 0; i < 200; i++) {
    feeDocs.push({
      studentId: randomItem(allStudents)._id,
      amount: randomInt(12000, 18000),
      status: "collected",
      month: currentMonth,
      dueDate: randomAdmissionDate(),
      paidDate: randomAdmissionDate(),
    });
  }
  for (let i = 0; i < 50; i++) {
    feeDocs.push({
      studentId: randomItem(allStudents)._id,
      amount: randomInt(12000, 18000),
      status: "pending",
      month: currentMonth,
      dueDate: randomAdmissionDate(),
    });
  }
  for (let i = 0; i < 15; i++) {
    feeDocs.push({
      studentId: randomItem(allStudents)._id,
      amount: randomInt(12000, 18000),
      status: "overdue",
      month: currentMonth,
      dueDate: randomAdmissionDate(),
    });
  }
  await FeeRecord.insertMany(feeDocs);

  // --- 11. Announcements ---
  console.log("Seeding announcements...");
  await Announcement.insertMany([
    {
      title: "Mid-Term Examination Results Declared",
      message: "The Mid-Term examination results for all grades have been published. Parents can check performance reports in the portal.",
      category: "exam",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      title: "Parent-Teacher Meeting (PTM)",
      message: "Monthly PTM is scheduled for Saturday, 20th September 2026. Timings: 09:00 AM to 01:00 PM.",
      category: "meeting",
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    },
    {
      title: "Annual Sports Day Registration",
      message: "Registration for track and field events is now open. Interested students contact P.E. Department.",
      category: "event",
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
    {
      title: "School Library Book Fair",
      message: "A 3-day Book Fair will be hosted in the main auditorium from 25th September.",
      category: "notice",
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
  ]);

  // --- 12. Admin & Parent Users ---
  console.log("Seeding principal and parent users...");
  const principalPasswordHash = await bcrypt.hash("Principal@123", 10);
  await User.create({
    name: "Dr. Ramesh Chandra (Principal)",
    email: "principal@exmple.edu",
    passwordHash: principalPasswordHash,
    role: "principal",
    phone: "9876543210",
  });

  const parentPasswordHash = await bcrypt.hash("Parent@123", 10);
  const aaravStudent = topPerformers.find((s) => s.name === "Aarav Sharma") || allStudents[0];
  const diyaStudent = topPerformers.find((s) => s.name === "Diya Patel") || allStudents[1];
  const vihaanStudent = topPerformers.find((s) => s.name === "Vihaan Mehta") || allStudents[2];

  await User.create({
    name: "Rakesh Sharma (Parent)",
    email: "parent@example.com",
    passwordHash: parentPasswordHash,
    role: "parent",
    phone: "9876543211",
    childStudentIds: aaravStudent ? [aaravStudent._id] : [],
  });

  await User.create({
    name: "Suresh Patel (Parent)",
    email: "parent2@example.com",
    passwordHash: parentPasswordHash,
    role: "parent",
    phone: "9876543212",
    childStudentIds: diyaStudent ? [diyaStudent._id] : [],
  });

  await User.create({
    name: "Pankaj Mehta (Parent)",
    email: "parent3@example.com",
    passwordHash: parentPasswordHash,
    role: "parent",
    phone: "9876543213",
    childStudentIds: vihaanStudent ? [vihaanStudent._id] : [],
  });

  console.log("\n=======================================================");
  console.log("✅ SCHOOL ERP SAMPLE DATA SEEDED SUCCESSFULLY!");
  console.log("=======================================================");
  console.log("📌 Principal Login:");
  console.log("   Email:    principal@exmple.edu");
  console.log("   Password: Principal@123\n");
  console.log("📌 Sample Teacher Login 1 (Class Teacher 10th-A):");
  console.log("   Email:    teacher@example.com");
  console.log("   Password: Teacher@123\n");
  console.log("📌 Sample Teacher Login 2 (Science Teacher 9th-B):");
  console.log("   Email:    teacher2@example.com");
  console.log("   Password: Teacher@123\n");
  console.log("📌 Sample Parent Login 1 (Aarav Sharma's Parent - 10th-A):");
  console.log("   Email:    parent@example.com");
  console.log("   Password: Parent@123\n");
  console.log("📌 Sample Parent Login 2 (Diya Patel's Parent - 9th-B):");
  console.log("   Email:    parent2@example.com");
  console.log("   Password: Parent@123\n");
  console.log("📌 Total Data Seeded:");
  console.log(`   - Classes:          ${classes.length}`);
  console.log(`   - Teachers:         ${teachers.length}`);
  console.log(`   - Students:         ${allStudents.length}`);
  console.log(`   - Sibling Links:    30 pairs`);
  console.log(`   - Attendance Recs:  ${attendanceRecordDocs.length}`);
  console.log(`   - Teacher Att Recs: ${teacherAttDocs.length}`);
  console.log(`   - Daily Entries:    ${diaryDocs.length}`);
  console.log(`   - Timetable Entries:${timetableDocs.length}`);
  console.log(`   - Exam Records:     ${examResultDocs.length}`);
  console.log(`   - Fee Records:      ${feeDocs.length}`);
  console.log("=======================================================\n");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
