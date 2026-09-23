const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { listClasses, createClass, disableClass, updateClass } = require("../controllers/classController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"), requirePermission("classes"));

router.get("/", asyncHandler(listClasses));
router.post("/", asyncHandler(createClass));
router.put("/:id", asyncHandler(updateClass));
router.delete("/:id", asyncHandler(disableClass));

module.exports = router;
