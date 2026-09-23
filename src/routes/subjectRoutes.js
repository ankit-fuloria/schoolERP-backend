const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { list, create, update, disable } = require("../controllers/subjectController");

const router = express.Router();
router.use(requireAuth, requireRole("principal", "staff"), requirePermission("subjects"));
router.get("/", asyncHandler(list));
router.post("/", asyncHandler(create));
router.put("/:id", asyncHandler(update));
router.delete("/:id", asyncHandler(disable));

module.exports = router;
