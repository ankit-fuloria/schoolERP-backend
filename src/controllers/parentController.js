const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Student = require("../models/Student");
const accountPhone = require('../utils/accountPhone');

// Minimal provisioning endpoint: creates a parent login linked to one or
// more existing Student records. No list/update/disable yet — parent
// account management doesn't have an admin screen in this pass.
async function create(req, res) {
  const { name, email, password, childStudentIds } = req.body;
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() || !password || !Array.isArray(childStudentIds) || childStudentIds.length === 0) {
    return res
      .status(400)
      .json({ message: "name, email, phone, password and at least one childStudentIds entry are required" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ message: 'Enter a valid email address' });

  const existing = await User.findOne({ email: email.trim().toLowerCase() });
  if (existing) {
    return res.status(400).json({ message: "That email is already in use" });
  }

  const children = await Student.find({ _id: { $in: childStudentIds } });
  if (children.length !== childStudentIds.length) {
    return res.status(400).json({ message: "One or more students could not be found" });
  }

  const phone = accountPhone.required(req.body.phone || children.find((child) => child.parentDashboardPhone)?.parentDashboardPhone);
  if (await User.exists({ phone: accountPhone.pattern(phone) })) {
    return res.status(409).json({ message: 'That phone number is already in use' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    role: "parent",
    phone,
    childStudentIds,
  });

  res.status(201).json({
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    childStudentIds: user.childStudentIds,
  });
}

module.exports = { create };
