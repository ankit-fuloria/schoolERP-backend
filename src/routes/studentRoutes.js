const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
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
  uploadStudentDocument,
} = require("../controllers/studentController");

const router = express.Router();
const uploadDir = path.join(__dirname, "../../uploads/student-documents");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(requireAuth, requireRole("principal", "staff"), requirePermission("students"));

router.get("/", asyncHandler(listStudents));
router.get("/summary", asyncHandler(getStudentSummary));
router.get("/disability-options", asyncHandler(listDisabilityOptions));
router.post("/disability-options", asyncHandler(createDisabilityOption));
router.get("/reservation-options", asyncHandler(listReservationOptions));
router.post("/reservation-options", asyncHandler(createReservationOption));
router.post("/documents", upload.single("document"), asyncHandler(uploadStudentDocument));
router.post("/", asyncHandler(createStudent));
router.put("/:id", asyncHandler(updateStudent));
router.delete("/:id", asyncHandler(disableStudent));

module.exports = router;
