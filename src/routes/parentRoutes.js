const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { create } = require("../controllers/parentController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"), requirePermission('students'));

router.post("/", asyncHandler(create));

module.exports = router;
