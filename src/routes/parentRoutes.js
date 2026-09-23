const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { create } = require("../controllers/parentController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"));

router.post("/", asyncHandler(create));

module.exports = router;
