const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { list, create, update, disable, uploadTeacherDocument } = require("../controllers/teacherController");

const router = express.Router();
const uploadDir = path.join(__dirname, "../../uploads/teacher-documents");

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

router.use(requireAuth, requireRole("principal", "staff"), requirePermission("teachers"));

router.get("/", asyncHandler(list));
router.post("/documents", upload.single("document"), asyncHandler(uploadTeacherDocument));
router.post("/", asyncHandler(create));
router.put("/:id", asyncHandler(update));
router.delete("/:id", asyncHandler(disable));

module.exports = router;
