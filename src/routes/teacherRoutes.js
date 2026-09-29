const express = require("express");
const files = require('../services/mediaStorage');
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { list, create, update, disable } = require("../controllers/teacherController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"), requirePermission("teachers"));

router.get("/", asyncHandler(list));
router.post("/documents", files.upload(), asyncHandler(files.handler('teachers')));
router.use(asyncHandler(async (req, res, next) => {
  if (['POST', 'PUT'].includes(req.method)) await files.validateReferences(req, 'teachers', req.body);
  next();
}));
router.post("/", asyncHandler(create));
router.put("/:id", asyncHandler(update));
router.delete("/:id", asyncHandler(disable));

module.exports = router;
