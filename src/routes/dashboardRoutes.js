const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { getPrincipalDashboard, getPrincipalReports, getPrincipalBilling } = require("../controllers/dashboardController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"));

router.get("/principal", asyncHandler(getPrincipalDashboard));
router.get("/reports", requirePermission('reports'), asyncHandler(getPrincipalReports));
router.get("/billing", requireRole('principal'), asyncHandler(getPrincipalBilling));

module.exports = router;
