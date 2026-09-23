const jwt = require("jsonwebtoken");
const { getTenantDB } = require("../config/db");

function resolveTenant(req, res, next) {
  try {
    let schoolCode = req.headers["x-school-code"] || req.headers["x-school-id"];

    // Fallback to token if header is not present
    if (!schoolCode) {
      const header = req.headers.authorization || "";
      if (header.startsWith("Bearer ")) {
        try {
          const token = header.slice(7);
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          schoolCode = decoded.schoolCode || decoded.schoolId || decoded.tenant;
        } catch (_) {
          // Token verification failed or not provided yet
        }
      }
    }

    // Default to 'owneradmin' if explicitly requested or unassigned
    if (!schoolCode) {
      schoolCode = "owneradmin";
    }

    req.schoolCode = String(schoolCode).trim().toLowerCase();
    req.tenantDb = getTenantDB(req.schoolCode);

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = resolveTenant;
