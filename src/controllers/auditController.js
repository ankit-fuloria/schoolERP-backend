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

  const Student = require("../models/Student");
  const studentIds = [
    ...new Set(
      items
        .map((i) => i.detail?.studentId)
        .filter((id) => id && typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id))
    ),
  ];
  let studentMap = new Map();
  if (studentIds.length > 0) {
    try {
      const students = await Student.find({ _id: { $in: studentIds } })
        .select("name admissionNo")
        .lean();
      studentMap = new Map(students.map((s) => [String(s._id), s]));
    } catch (_) {}
  }

  for (const item of items) {
    if (item.detail && typeof item.detail === "object") {
      if (item.detail.studentId && studentMap.has(String(item.detail.studentId))) {
        const st = studentMap.get(String(item.detail.studentId));
        item.detail.studentName = st.name;
        if (st.admissionNo) item.detail.admissionNo = st.admissionNo;
      }
      // If note is missing or generic, synthesize a human-readable note
      if (!item.note || item.note === "No description provided" || item.note === "Entry recorded") {
        if (item.entityType === "Transaction" || item.entityType === "FeeRecord") {
          const sName = item.detail.studentName ? ` for ${item.detail.studentName}` : "";
          const months = Array.isArray(item.detail.monthsCovered) && item.detail.monthsCovered.length > 0
            ? ` (${item.detail.monthsCovered.join(", ")})`
            : item.detail.month ? ` (${item.detail.month})` : "";
          const mode = item.detail.paymentMode ? ` via ${String(item.detail.paymentMode).toUpperCase()}` : "";
          const amt = item.detail.amount != null ? `₹${item.detail.amount}` : "fee";
          item.note = `Fee payment of ${amt}${sName}${months}${mode} recorded`;
        }
      }
      // Never expose raw technical IDs to the client
      delete item.detail.studentId;
      delete item.detail._id;
      delete item.detail.classId;
      delete item.detail.teacherId;
      delete item.detail.chargeId;
      delete item.detail.cycleId;
      delete item.detail.planId;
      delete item.detail.schoolId;
      delete item.detail.branchId;
      delete item.detail.userId;
      delete item.detail.transactionId;
    }
    // Remove raw entityId if it's a 24-character hexadecimal ObjectId
    if (typeof item.entityId === "string" && /^[a-fA-F0-9]{24}$/.test(item.entityId)) {
      item.entityId = undefined;
    }
  }

  res.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

module.exports = { listAuditLogs };
