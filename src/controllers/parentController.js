const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Student = require("../models/Student");

// Minimal provisioning endpoint: creates a parent login linked to one or
// more existing Student records. No list/update/disable yet — parent
// account management doesn't have an admin screen in this pass.
async function create(req, res) {
  const { name, email, password, childStudentIds } = req.body;
  if (!name || !email || !password || !Array.isArray(childStudentIds) || childStudentIds.length === 0) {
    return res
      .status(400)
      .json({ message: "name, email, password and at least one childStudentIds entry are required" });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(400).json({ message: "That email is already in use" });
  }

  const children = await Student.find({ _id: { $in: childStudentIds } });
  if (children.length !== childStudentIds.length) {
    return res.status(400).json({ message: "One or more students could not be found" });
  }

  const phone = req.body.phone || children.find((child) => child.parentDashboardPhone)?.parentDashboardPhone;

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email: email.toLowerCase(),
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
