const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { getSettings, updateSettings, getTerms, addTerm, deleteTerm } = require("../controllers/settingsController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"), requirePermission("settings"));

router.get("/", asyncHandler(getSettings));
router.put("/", asyncHandler(updateSettings));

// Academic terms sub-resource
router.get("/terms", asyncHandler(getTerms));
router.post("/terms", asyncHandler(addTerm));
router.delete("/terms/:term", asyncHandler(deleteTerm));

module.exports = router;
