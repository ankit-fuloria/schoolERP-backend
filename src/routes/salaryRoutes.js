const express = require("express");
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const salaryController = require("../controllers/salaryController");

router.use(requireAuth, requireRole('principal', 'staff'), requirePermission('fees'));

router.get("/config", salaryController.getConfig);
router.put("/config", requireRole("principal", "admin"), salaryController.updateConfig);
router.put("/teacher/:id", requireRole("principal", "admin"), salaryController.setTeacherSalary);
router.put("/staff/:id", requireRole("principal", "admin"), salaryController.setStaffSalary);
router.get("/report", salaryController.getSalaryReport);
router.get("/teacher-detail/:id", salaryController.getTeacherDetailAttendance);
router.put(
  "/attendance/:id/remove-half-day",
  requireRole("principal", "admin"),
  salaryController.removeHalfDay
);

module.exports = router;
