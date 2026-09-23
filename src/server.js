require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const morgan = require("morgan");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const studentRoutes = require("./routes/studentRoutes");
const classRoutes = require("./routes/classRoutes");
const makeSimpleRouter = require("./utils/makeSimpleRouter");
const subjectRoutes = require("./routes/subjectRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const staffRoutes = require("./routes/staffRoutes");
const teacherPortalRoutes = require("./routes/teacherPortalRoutes");
const parentRoutes = require("./routes/parentRoutes");
const parentPortalRoutes = require("./routes/parentPortalRoutes");
const Exam = require("./models/Exam");
const TimetableEntry = require("./models/TimetableEntry");
const LibraryBook = require("./models/LibraryBook");
const TransportRoute = require("./models/TransportRoute");
const HostelRoom = require("./models/HostelRoom");
const Announcement = require("./models/Announcement");
const attendanceRoutes = require("./routes/attendanceRoutes");
const feesRoutes = require("./routes/feesRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const auditRoutes = require("./routes/auditRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use('/api/owner', require('./routes/ownerRoutes'));
app.post('/api/auth/login', require('./routes/ownerRoutes').sharedLogin);
app.use('/api', require('./tenancy/access').gate);
app.use('/api/branches', require('./routes/branchAccessRoutes'));
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/teacher", teacherPortalRoutes);
app.use("/api/parents", parentRoutes);
app.use("/api/parent", parentPortalRoutes);
app.use("/api/exam-workflow", require("./routes/examWorkflowRoutes"));
app.use("/api/transfers", require("./routes/transferRoutes"));
app.use("/api/section-transfers", require("./routes/sectionTransferRoutes"));
app.use(
  "/api/exams",
  (req, res, next) => {
    if (req.method !== "GET") return res.status(409).json({ message: "Use /api/exam-workflow for exam structures, datesheets and result approvals" });
    next();
  },
  makeSimpleRouter(Exam, {
    searchFields: ["name", "subject"],
    sort: { examDate: -1 },
    populate: { path: "classId", select: "name grade section" },
    permission: "examinations",
  })
);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/fees", feesRoutes);
app.use("/api/subjects", subjectRoutes);
const timetableRoutes = require("./routes/timetableRoutes");
app.use("/api/timetable", timetableRoutes);
const teacherAttendanceRoutes = require("./routes/teacherAttendanceRoutes");
app.use("/api/teacher/attendance", teacherAttendanceRoutes);
const salaryRoutes = require("./routes/salaryRoutes");
app.use("/api/salary", salaryRoutes);
app.use(
  "/api/library",
  makeSimpleRouter(LibraryBook, { searchFields: ["title", "author", "isbn"], permission: "library" })
);
app.use(
  "/api/transport",
  makeSimpleRouter(TransportRoute, {
    searchFields: ["routeName", "vehicleNumber", "driverName"],
    permission: "transport",
  })
);
app.use(
  "/api/hostel",
  makeSimpleRouter(HostelRoom, { searchFields: ["roomNumber", "block"], permission: "hostel" })
);
app.use(
  "/api/announcements",
  makeSimpleRouter(Announcement, {
    searchFields: ["title", "message"],
    sort: { createdAt: -1 },
    permission: "communications",
  })
);
app.use("/api/settings", settingsRoutes);
app.use("/api/audit", auditRoutes);

app.use((err, req, res, next) => {
  console.error('API error:', err.name, err.status || err.code || 500);
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.name === "ValidationError") return res.status(400).json({ message: err.message });
  if (err.name === "CastError") {
    return res.status(400).json({ message: "Invalid id" });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: err.keyPattern?.code && !err.keyPattern?.schoolId ? 'School code is already in use. Choose a unique code.' : 'This code or database is already in use' });
  }
  res.status(500).json({ message: "Something went wrong" });
});

const PORT = process.env.PORT || 5050;

connectDB()
  .then(() => require('./tenancy/initialize')())
  .then(() => {
    require('./tenancy/billing').start();
    app.listen(PORT, () => console.log(`Schoolo API running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize databases. Check MongoDB configuration and connectivity.");
    process.exit(1);
  });
