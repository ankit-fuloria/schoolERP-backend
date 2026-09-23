const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { listAuditLogs } = require("../controllers/auditController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"), requirePermission("reports"));

router.get("/", asyncHandler(listAuditLogs));

module.exports = router;
