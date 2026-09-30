const bcrypt = require("bcryptjs");
const { authenticatePrincipal, linkLegacyPrincipal, sign } = require('../tenancy/access');
const User = require("../models/User");
const Staff = require("../models/Staff");
const platform = require('../tenancy/platform');
const accountPhone = require('../utils/accountPhone');
const { publicEmail } = require('../services/parentProvisioning');

async function login(req, res) {
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ message: "Email/mobile and password are required" });
  }

  const identifier = email.trim();
  const phone = accountPhone.pattern(identifier);
  let user = await authenticatePrincipal(identifier, password);
  if (!user) {
    const candidates = await User.find({ $or: [{ email: identifier.toLowerCase() }, ...(phone ? [{ phone }] : [])] });
    for (const candidate of candidates) {
      if (await bcrypt.compare(password, candidate.passwordHash)) { user = candidate; break; }
    }
  }
  if (!user) {
    return res.status(401).json({ message: "Invalid email/phone number or password" });
  }
  if (user.role === 'principal' && user.platformPrincipalId) {
    const principal = await platform.get().Principal.findOne({ _id: user.platformPrincipalId, schoolId: req.tenant.school._id, active: true });
    if (!principal || principal.email !== user.email || (principal.phone || '') !== (user.phone || '')) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
  }

  if (user.active === false) {
    return res.status(403).json({ message: "This account has been disabled" });
  }

  await linkLegacyPrincipal(user);
  const token = sign(user);

  let department;
  let permissions;
  if (user.role === "staff") {
    const staff = await Staff.findOne({ userId: user._id }).select("department permissions");
    department = staff?.department;
    permissions = staff?.permissions || [];
  }

  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: publicEmail(user),
      role: user.role,
      phone: user.phone,
      schoolAccess: req.tenant?.schoolAccess || 'active',
      ...(department !== undefined ? { department } : {}),
      ...(permissions !== undefined ? { permissions } : {}),
    },
  });
}

module.exports = { login };
