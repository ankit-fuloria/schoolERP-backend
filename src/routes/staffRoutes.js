const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { list, listDepartments, create, update, disable, uploadStaffDocument } = require("../controllers/staffController");

const router = express.Router();
const uploadDir = path.join(__dirname, "../../uploads/staff-documents");

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
      cb(null, `${Date.now()}-${safeName}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Managing staff accounts (and the permissions they're granted) is
// principal-only — a staff member must never be able to create or edit
// other staff, since that would let them grant themselves more access.
router.use(requireAuth, requireRole("principal"));

router.get("/", asyncHandler(list));
router.get("/departments", asyncHandler(listDepartments));
router.post("/documents", upload.single("document"), asyncHandler(uploadStaffDocument));
router.post("/", asyncHandler(create));
router.put("/:id", asyncHandler(update));
router.delete("/:id", asyncHandler(disable));

module.exports = router;
