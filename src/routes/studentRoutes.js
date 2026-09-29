const express = require("express");
const files = require('../services/mediaStorage');
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const {
  listStudents,
  getStudentSummary,
  createStudent,
  disableStudent,
  updateStudent,
  listDisabilityOptions,
  createDisabilityOption,
  listReservationOptions,
  createReservationOption,
} = require("../controllers/studentController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"), requirePermission("students"));
router.get('/classes', asyncHandler(require('../controllers/feeLookupController').classes));

router.get("/", asyncHandler(listStudents));
router.get("/summary", asyncHandler(getStudentSummary));
router.get("/disability-options", asyncHandler(listDisabilityOptions));
router.post("/disability-options", asyncHandler(createDisabilityOption));
router.get("/reservation-options", asyncHandler(listReservationOptions));
router.post("/reservation-options", asyncHandler(createReservationOption));
router.post("/documents", files.upload(), asyncHandler(files.handler('students')));
router.use(asyncHandler(async (req, res, next) => {
  if (['POST', 'PUT'].includes(req.method)) await files.validateReferences(req, 'students', req.body);
  next();
}));
router.post("/", asyncHandler(createStudent));
router.put("/:id", asyncHandler(updateStudent));
router.delete("/:id", asyncHandler(disableStudent));

module.exports = router;
