const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { getRoster, markAttendance, getSummary } = require("../controllers/attendanceController");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/roster",
  requireRole("principal", "staff", "teacher"),
  requirePermission("attendance"),
  asyncHandler(getRoster)
);
router.post(
  "/mark",
  requireRole("principal", "staff", "teacher"),
  requirePermission("attendance"),
  asyncHandler(markAttendance)
);
router.get(
  "/summary",
  requireRole("principal", "staff", "teacher"),
  requirePermission("attendance"),
  asyncHandler(getSummary)
);

module.exports = router;
