require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const User = require("../src/models/User");
const Student = require("../src/models/Student");
const SchoolClass = require("../src/models/SchoolClass");
const AttendanceRecord = require("../src/models/AttendanceRecord");
const Exam = require("../src/models/Exam");
const ExamResult = require("../src/models/ExamResult");
const FeeRecord = require("../src/models/FeeRecord");
const ClassDiary = require("../src/models/ClassDiary");
const TimetableEntry = require("../src/models/TimetableEntry");
const Teacher = require("../src/models/Teacher");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seedParentData() {
  await connectDB();
  console.log("Seeding parent@example.com data for 3 children...");

  const parent = await User.findOne({ email: "parent@example.com" });
  if (!parent) {
    console.error("Parent user parent@example.com not found!");
    process.exit(1);
  }

  // Find target classes for 3 children across different grade bands
  let class10A = await SchoolClass.findOne({ name: "10th-A" });
  let class6A = await SchoolClass.findOne({ name: "6th-A" });
  let class2A = await SchoolClass.findOne({ name: "2nd-A" });

  if (!class10A) class10A = await SchoolClass.findOne({ grade: "10th" }) || await SchoolClass.findOne();
  if (!class6A) class6A = await SchoolClass.findOne({ grade: "6th" }) || await SchoolClass.findOne();
  if (!class2A) class2A = await SchoolClass.findOne({ grade: "2nd" }) || await SchoolClass.findOne();

  console.log(`Classes assigned -> Child 1: ${class10A.name}, Child 2: ${class6A.name}, Child 3: ${class2A.name}`);

  // Create or Update 3 Children
  const childrenConfig = [
    {
      name: "Aarav Sharma",
      admissionNo: "ADM-PAR-001",
      rollNo: 12,
      gender: "Male",
      dateOfBirth: new Date("2011-04-15"),
      classId: class10A._id,
      attendancePercent: 96,
      performancePercent: 94.5,
    },
    {
      name: "Ananya Sharma",
      admissionNo: "ADM-PAR-002",
      rollNo: 8,
      gender: "Female",
      dateOfBirth: new Date("2015-08-20"),
      classId: class6A._id,
      attendancePercent: 94,
      performancePercent: 91.2,
    },
    {
      name: "Reyansh Sharma",
      admissionNo: "ADM-PAR-003",
      rollNo: 5,
      gender: "Male",
      dateOfBirth: new Date("2019-02-10"),
      classId: class2A._id,
      attendancePercent: 98,
      performancePercent: 95.8,
    },
  ];

  const childDocs = [];
  for (const config of childrenConfig) {
    let student = await Student.findOne({ admissionNo: config.admissionNo });
    if (!student) {
      student = await Student.findOne({ name: config.name });
    }

    if (student) {
      student.name = config.name;
      student.classId = config.classId;
      student.rollNo = config.rollNo;
      student.gender = config.gender;
      student.dateOfBirth = config.dateOfBirth;
      student.fatherName = "Rakesh Sharma";
      student.fatherPhone = "9876543211";
      student.motherName = "Sunita Sharma";
      student.motherPhone = "9876543212";
      student.address = "42, Green Park Avenue, Bengaluru";
      student.status = "active";
      student.attendancePercent = config.attendancePercent;
      student.performancePercent = config.performancePercent;
      await student.save();
    } else {
      student = await Student.create({
        ...config,
        fatherName: "Rakesh Sharma",
        fatherPhone: "9876543211",
        motherName: "Sunita Sharma",
        motherPhone: "9876543212",
        address: "42, Green Park Avenue, Bengaluru",
        status: "active",
        admissionDate: new Date("2022-06-01"),
      });
    }
    childDocs.push(student);
  }

  // Link sibling IDs mutually
  const childIds = childDocs.map((c) => c._id);
  for (const child of childDocs) {
    child.siblingIds = childIds.filter((id) => !id.equals(child._id));
    await child.save();
  }

  // Link all 3 children to parent@example.com
  parent.childStudentIds = childIds;
  await parent.save();
  console.log(`Linked ${childIds.length} children to parent@example.com.`);

  // 1. Seed Attendance Records for past 30 days
  console.log("Seeding attendance records for all 3 children...");
  await AttendanceRecord.deleteMany({ studentId: { $in: childIds } });
  const attendanceDocs = [];
  const today = new Date();

  for (let dOff = 30; dOff >= 0; dOff--) {
    const d = new Date(today);
    d.setDate(d.getDate() - dOff);
    const dayName = DAY_NAMES[d.getDay()];
    if (dayName === "Sunday") continue;

    const normalizedDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

    for (let cIdx = 0; cIdx < childDocs.length; cIdx++) {
      const child = childDocs[cIdx];
      const roll = Math.random();
      let status = "present";
      let lateTime = "";

      if (roll < 0.90) {
        status = "present";
      } else if (roll < 0.95) {
        status = "late";
        lateTime = "08:45 AM";
      } else {
        status = "leave";
      }

      attendanceDocs.push({
        classId: child.classId,
        studentId: child._id,
        date: normalizedDate,
        status,
        lateTime,
      });
    }
  }
  await AttendanceRecord.insertMany(attendanceDocs);

  // 2. Seed Exams & Exam Results
  console.log("Seeding exam results for all 3 children...");
  const subjectsMap = {
    [class10A._id.toString()]: ["Mathematics", "Science", "English", "Social Studies"],
    [class6A._id.toString()]: ["Mathematics", "Science", "English", "Social Studies"],
    [class2A._id.toString()]: ["Mathematics", "EVS", "English", "Hindi"],
  };

  const marksPattern = [
    { marks: 95, remarks: "Outstanding performance! Top of class." },
    { marks: 91, remarks: "Excellent work and consistent effort." },
    { marks: 88, remarks: "Very Good. Shows great grasp of concepts." },
    { marks: 94, remarks: "Superb analytical skills." },
  ];

  for (const child of childDocs) {
    const classId = child.classId.toString();
    const subjects = subjectsMap[classId] || ["Mathematics", "Science", "English"];

    for (let sIdx = 0; sIdx < subjects.length; sIdx++) {
      const subj = subjects[sIdx];
      let exam = await Exam.findOne({ classId: child.classId, subject: subj, name: "Mid-Term Examination 2026" });
      if (!exam) {
        exam = await Exam.create({
          name: "Mid-Term Examination 2026",
          subject: subj,
          classId: child.classId,
          examDate: new Date(Date.now() - (10 + sIdx * 2) * 24 * 60 * 60 * 1000),
          totalMarks: 100,
          resultsPublished: true,
          resultsPublishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          status: "active",
        });
      } else {
        exam.resultsPublished = true;
        exam.resultsPublishedAt = new Date();
        await exam.save();
      }

      const pattern = marksPattern[sIdx % marksPattern.length];
      await ExamResult.findOneAndUpdate(
        { examId: exam._id, studentId: child._id },
        {
          $set: {
            marksObtained: pattern.marks,
            remarks: pattern.remarks,
          },
        },
        { upsert: true }
      );
    }
  }

  // 3. Seed Fee Records for all 3 children
  console.log("Seeding fee records for all 3 children...");
  await FeeRecord.deleteMany({ studentId: { $in: childIds } });
  const feeDocs = [];
  const feeMonths = [
    { month: "June 2026", amount: 15000, status: "collected", mode: "upi", ref: "UPI/6198273619" },
    { month: "July 2026", amount: 15000, status: "collected", mode: "upi", ref: "UPI/6201823712" },
    { month: "August 2026", amount: 15000, status: "collected", mode: "bank_transfer", ref: "NFT/827361928" },
    { month: "September 2026", amount: 15000, status: "pending", mode: null, ref: null },
  ];

  for (const child of childDocs) {
    for (const f of feeMonths) {
      feeDocs.push({
        studentId: child._id,
        classId: child.classId,
        amount: f.amount,
        status: f.status,
        month: f.month,
        dueDate: new Date("2026-09-15"),
        paidDate: f.status === "collected" ? new Date("2026-08-05") : undefined,
        paymentMode: f.mode,
        transactionRef: f.ref,
        remarks: f.status === "collected" ? "Paid online via Parent Portal" : "Installment due on 15th Sep",
      });
    }
  }
  await FeeRecord.insertMany(feeDocs);

  // 4. Ensure Daily Class Diary entries for their classes
  console.log("Ensuring daily class diary entries...");
  const sampleTeachers = await Teacher.find({ status: "active" });
  for (const child of childDocs) {
    const classId = child.classId;
    const existingDiary = await ClassDiary.findOne({ classId });
    if (!existingDiary) {
      await ClassDiary.create({
        classId,
        subject: "Mathematics",
        teacherId: sampleTeachers[0]?._id,
        teacherName: sampleTeachers[0]?.name || "Teacher Staff",
        date: new Date().toISOString().split("T")[0],
        topicTaught: "Algebra & Linear Equations Practice",
        classwork: "Solved exercise 3.1 problems 1 through 10 in class notebooks.",
        homework: "Complete remaining problems 11 through 20 in HW book.",
        remarks: "Active participation in class today.",
      });
    }
  }

  console.log("=======================================================");
  console.log("✅ PARENT DATA SEEDED SUCCESSFULLY FOR parent@example.com!");
  console.log("=======================================================");
  console.log("📌 Parent Login Email: parent@example.com");
  console.log("📌 Parent Password:    Parent@123");
  console.log("📌 Children Linked:");
  childDocs.forEach((c, idx) => {
    console.log(`   ${idx + 1}. ${c.name} (Class: ${c.admissionNo}, ID: ${c._id})`);
  });
  console.log("=======================================================\n");

  await mongoose.disconnect();
}

seedParentData().catch((err) => {
  console.error("❌ Seeding parent data failed:", err);
  process.exit(1);
});
