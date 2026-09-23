const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const teacherAttendanceController = require("../controllers/teacherAttendanceController");

router.use(requireAuth, requireRole("teacher"));

router.get("/check-status", teacherAttendanceController.getCheckStatus);
router.get("/logs", teacherAttendanceController.getAttendanceLogs);
router.post("/check-in", teacherAttendanceController.checkIn);
router.post("/check-out", teacherAttendanceController.checkOut);

module.exports = router;
