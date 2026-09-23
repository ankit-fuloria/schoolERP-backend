const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const {
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
} = require("../controllers/teacherPortalController");

const router = express.Router();

router.use(requireAuth, requireRole("teacher"));

router.get("/me", asyncHandler(getMe));
router.get("/dashboard", asyncHandler(getDashboard));
router.get("/classes", asyncHandler(getClasses));
router.get("/syllabus/classes", asyncHandler(getSyllabusClasses));
router.get("/syllabus/grades/:grade", asyncHandler(getGradeSyllabus));
router.get("/classes/:classId/students", asyncHandler(getClassStudents));
router.get("/timetable", asyncHandler(getTimetable));
router.get("/classes/:classId/timetable", asyncHandler(getEditableClassTimetable));
router.post("/timetable/entries", asyncHandler(saveEditableTimetableEntry));
router.put("/timetable/entries/:id", asyncHandler(saveEditableTimetableEntry));
router.delete("/timetable/entries/:id", asyncHandler(deleteEditableTimetableEntry));
router.get("/exams", asyncHandler(getExams));
router.get("/exams/:examId/results", asyncHandler(getExamResults));
router.put("/exams/:examId/results", asyncHandler(saveExamResults));
router.get("/announcements", asyncHandler(getAnnouncements));
router.post("/announcements", asyncHandler(createAnnouncement));
router.post("/request-change-password-otp", asyncHandler(requestPasswordResetOtp));
router.post("/verify-otp", asyncHandler(verifyPasswordResetOtp));
router.post("/change-password", asyncHandler(changePasswordWithOtp));
router.get("/class-diary", asyncHandler(getClassDiary));
router.post("/class-diary", asyncHandler(createClassDiaryEntry));
router.delete("/class-diary/:id", asyncHandler(deleteClassDiaryEntry));

module.exports = router;
