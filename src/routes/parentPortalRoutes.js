const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const {
  getChildren,
  getDashboard,
  getAttendance,
  getTimetable,
  getSyllabus,
  getAssignments,
  getAnnualCharges,
} = require("../controllers/parentPortalController");

const router = express.Router();

router.use(requireAuth, requireRole("parent"));

router.get("/children", asyncHandler(getChildren));
router.get("/dashboard", asyncHandler(getDashboard));
router.get("/attendance", asyncHandler(getAttendance));
router.get("/timetable", asyncHandler(getTimetable));
router.get("/syllabus", asyncHandler(getSyllabus));
router.get("/assignments", asyncHandler(getAssignments));
router.get("/annual-charges", asyncHandler(getAnnualCharges));

module.exports = router;
