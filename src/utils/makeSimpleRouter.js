const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const makeSimpleCrud = require("./simpleCrud");

function makeSimpleRouter(Model, options = {}) {
  const { list, create, update, remove } = makeSimpleCrud(Model, options);
  const router = express.Router();

  const middlewares = [requireAuth, requireRole("principal", "staff")];
  if (options.permission) middlewares.push(requirePermission(options.permission));
  router.use(...middlewares);

  router.get("/", asyncHandler(list));
  router.post("/", asyncHandler(create));
  router.put("/:id", asyncHandler(update));
  router.delete("/:id", asyncHandler(remove));

  return router;
}

module.exports = makeSimpleRouter;
