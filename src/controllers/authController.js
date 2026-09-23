const bcrypt = require("bcryptjs");
const { authenticatePrincipal, linkLegacyPrincipal, sign } = require('../tenancy/access');
const User = require("../models/User");
const Staff = require("../models/Staff");

async function login(req, res) {
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ message: "Email/mobile and password are required" });
  }

  const identifier = email.trim();
  const user = await authenticatePrincipal(identifier, password) || await User.findOne({
    $or: [{ email: identifier.toLowerCase() }, { phone: identifier }],
  });
  if (!user) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid email or password" });
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
      email: user.email,
      role: user.role,
      phone: user.phone,
      ...(department !== undefined ? { department } : {}),
      ...(permissions !== undefined ? { permissions } : {}),
    },
  });
}

module.exports = { login };
