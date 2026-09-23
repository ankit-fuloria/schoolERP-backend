const jwt = require("jsonwebtoken");
const Staff = require("../models/Staff");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Missing auth token" });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

// Gates a section for restricted staff accounts. Principals (and any other
// role that reaches this point) are unrestricted. Permissions are read fresh
// from the Staff record on every request (not cached in the JWT) so a
// principal editing a staff member's permissions takes effect immediately,
// without waiting for that staff member to log in again.
function requirePermission(section) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (req.user.role !== "staff") {
      return next();
    }
    try {
      const staff = await Staff.findOne({ userId: req.user.id }).select("permissions status");
      if (!staff || staff.status === "inactive" || !(staff.permissions || []).includes(section)) {
        return res.status(403).json({ message: "Forbidden: missing permission" });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireAuth, requireRole, requirePermission };
