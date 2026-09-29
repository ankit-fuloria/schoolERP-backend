const express = require("express");
const files = require('../services/mediaStorage');
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { list, listDepartments, create, update, disable } = require("../controllers/staffController");

const router = express.Router();

// Managing staff accounts (and the permissions they're granted) is
// principal-only — a staff member must never be able to create or edit
// other staff, since that would let them grant themselves more access.
router.use(requireAuth, requireRole("principal"));

router.get("/", asyncHandler(list));
router.get("/departments", asyncHandler(listDepartments));
router.post('/departments', asyncHandler(require('../controllers/staffController').createDepartment));
router.post("/documents", files.upload(), asyncHandler(files.handler('staff')));
router.use(asyncHandler(async (req, res, next) => {
  if (['POST', 'PUT'].includes(req.method)) await files.validateReferences(req, 'staff', req.body);
  next();
}));
router.post("/", asyncHandler(create));
router.put("/:id", asyncHandler(update));
router.delete("/:id", asyncHandler(disable));

module.exports = router;
