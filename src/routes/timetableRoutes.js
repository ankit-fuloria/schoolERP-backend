const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const {
  getStructure,
  updateStructure,
  getGrid,
  bulkSaveGrid,
  autoGenerateTimetable,
  list,
  create,
  update,
  remove,
} = require("../controllers/timetableController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"), requirePermission("timetable"));

router.get("/structure", asyncHandler(getStructure));
router.put("/structure", asyncHandler(updateStructure));
router.get("/grid", asyncHandler(getGrid));
router.post("/bulk-save", asyncHandler(bulkSaveGrid));
router.post("/auto-generate", asyncHandler(autoGenerateTimetable));

router.get("/", asyncHandler(list));
router.post("/", asyncHandler(create));
router.put("/:id", asyncHandler(update));
router.delete("/:id", asyncHandler(remove));

module.exports = router;
