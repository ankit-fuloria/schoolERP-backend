const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const c = require("../controllers/sectionTransferController");

const router = express.Router();

router.use(requireAuth, requireRole("teacher", "principal", "staff"), requirePermission('students'));

router.get("/available-classes", asyncHandler(c.getAvailableClasses));
router.get("/", asyncHandler(c.listRequests));
router.post("/", asyncHandler(c.createRequest));
router.post("/:id/approve", asyncHandler(c.approveRequest));
router.post("/:id/reject", asyncHandler(c.rejectRequest));

module.exports = router;
