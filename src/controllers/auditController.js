const AuditLog = require("../models/AuditLog");

// Read-only by design — there is deliberately no POST/PUT here. Letting a
// client write its own audit entries would let anyone forge history.
async function listAuditLogs(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const { entityType, entityId, action, role, search, startDate, endDate } = req.query;

  const filter = {};

  if (entityType) {
    if (entityType.includes(",")) {
      filter.entityType = { $in: entityType.split(",").map((s) => s.trim()).filter(Boolean) };
    } else {
      filter.entityType = entityType.trim();
    }
  }

  if (entityId) filter.entityId = entityId;

  if (action) {
    if (action.includes(",")) {
      filter.action = { $in: action.split(",").map((s) => s.trim()).filter(Boolean) };
    } else {
      filter.action = action.trim();
    }
  }

  if (role) {
    filter["performedBy.role"] = role.trim();
  }

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) {
      const s = new Date(startDate);
      if (!isNaN(s)) filter.createdAt.$gte = s;
    }
    if (endDate) {
      const e = new Date(endDate);
      if (!isNaN(e)) {
        // Include full day if only date is passed
        e.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = e;
      }
    }
  }

  if (search && search.trim()) {
    const q = search.trim();
    filter.$or = [
      { note: { $regex: q, $options: "i" } },
      { "performedBy.name": { $regex: q, $options: "i" } },
      { "performedBy.email": { $regex: q, $options: "i" } },
      { entityType: { $regex: q, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

module.exports = { listAuditLogs };
