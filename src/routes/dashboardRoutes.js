const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { getPrincipalDashboard, getPrincipalReports, getPrincipalBilling } = require("../controllers/dashboardController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"));

router.get("/principal", asyncHandler(getPrincipalDashboard));
router.get("/reports", asyncHandler(getPrincipalReports));
router.get("/billing", asyncHandler(getPrincipalBilling));

module.exports = router;
