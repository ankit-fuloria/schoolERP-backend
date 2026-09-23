const { logAction } = require("./auditLog");

function makeSimpleCrud(Model, { searchFields = [], sort = { createdAt: -1 }, populate = null } = {}) {
  const entityType = Model.modelName;

  async function list(req, res) {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 10));
    const { search, includeInactive, status } = req.query;

    const filter = {};
    if (search && searchFields.length) {
      filter.$or = searchFields.map((f) => ({ [f]: { $regex: search, $options: "i" } }));
    }
    if (status) {
      filter.status = status;
    } else if (!includeInactive) {
      filter.status = { $ne: "inactive" };
    }

    let query = Model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);
    if (populate) query = query.populate(populate);
    let countQuery = Model.countDocuments(filter);

    const [items, total] = await Promise.all([query, countQuery]);

    res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  }

  async function create(req, res) {
    const item = await Model.create(req.body);
    await logAction({ req, entityType, entityId: item._id, action: "create", detail: req.body });
    res.status(201).json(item);
  }

  async function update(req, res) {
    const item = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: "Not found" });
    await logAction({ req, entityType, entityId: item._id, action: "update", detail: req.body });
    res.json(item);
  }

  // "Delete" only disables the record (sets status: inactive) — nothing is ever
  // hard-deleted so history/references stay intact. Re-enable via PUT {status: "active"}.
  async function remove(req, res) {
    const item = await Model.findByIdAndUpdate(
      req.params.id,
      { status: "inactive" },
      { new: true }
    );
    if (!item) return res.status(404).json({ message: "Not found" });
    await logAction({ req, entityType, entityId: item._id, action: "disable" });
    res.json({ message: "Disabled", item });
  }

  return { list, create, update, remove };
}

module.exports = makeSimpleCrud;
