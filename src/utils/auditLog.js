const AuditLog = require("../models/AuditLog");
const User = require("../models/User");

// Strips fields that must never be persisted in plain form (passwords, hashes,
// tokens) before a request body is stored as audit detail.
function redactSecrets(body) {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body)) return body.map(redactSecrets);
  const sensitiveKeys = new Set([
    "password",
    "passwordHash",
    "token",
    "secret",
    "currentPassword",
    "newPassword",
    "confirmPassword",
    "authorization",
    "principalPassword",
  ]);
  const clone = {};
  for (const [key, val] of Object.entries(body)) {
    if (sensitiveKeys.has(key)) continue;
    if (val && typeof val === "object") {
      clone[key] = redactSecrets(val);
    } else {
      clone[key] = val;
    }
  }
  return clone;
}

// Writes one audit entry. Never throws — a logging failure must not block the
// real mutation it's describing, so errors are only logged to the console.
async function logAction({ req, entityType, entityId, action, detail, note }) {
  try {
    let userId = req?.user?.id || req?.owner?.id;
    let role = req?.user?.role || (req?.owner ? "owner" : "system");
    let name = "Unknown";
    let email = undefined;

    if (req?.owner) {
      name = req.owner.name || "Owner Admin";
      email = req.owner.email;
      role = "owner";
    } else if (userId) {
      const user = await User.findById(userId).select("name email role");
      if (user) {
        name = user.name || name;
        email = user.email || email;
        if (user.role) role = user.role;
      }
    }

    const { storage } = require("../tenancy/context");
    const scope = storage.getStore();
    const schoolId = scope?.school?._id;
    const branchId = scope?.branch?._id;
    const branchName = scope?.branch?.name;

    const ipAddress =
      req?.ip ||
      (req?.headers ? req.headers["x-forwarded-for"] : null) ||
      req?.socket?.remoteAddress;

    await AuditLog.create({
      schoolId,
      branchId,
      branchName,
      entityType,
      entityId,
      action,
      performedBy: { userId, role, name, email },
      detail: detail ? redactSecrets(detail) : undefined,
      note,
      ipAddress,
    });
  } catch (err) {
    console.error("Failed to write audit log", err);
  }
}

module.exports = { logAction, redactSecrets };
