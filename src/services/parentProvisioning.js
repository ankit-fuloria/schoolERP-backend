const bcrypt = require('bcryptjs');
const User = require('../models/User');
const accountPhone = require('../utils/accountPhone');

const INTERNAL_EMAIL_DOMAIN = 'parent-login.schoolo.invalid';

function initialPassword(schoolCode, dateOfBirth) {
  const code = String(schoolCode || '').trim().toUpperCase();
  const date = new Date(dateOfBirth);
  if (!code || Number.isNaN(date.getTime())) {
    throw Object.assign(new Error('School code and student date of birth are required for parent login'), { status: 400 });
  }
  return `${code}${date.getUTCFullYear()}`;
}

function internalEmail(phone) {
  return `parent+${phone}@${INTERNAL_EMAIL_DOMAIN}`;
}

function publicEmail(user) {
  return user.role === 'parent' && user.email?.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`)
    ? ''
    : user.email;
}

async function provisionForStudent(student, schoolCode) {
  const phone = accountPhone.required(student.parentDashboardPhone);
  const matches = await User.find({ phone: accountPhone.pattern(phone) });
  const otherAccount = matches.find((user) => user.role !== 'parent' || user.active === false);
  if (otherAccount) {
    throw Object.assign(new Error('Selected parent phone is already used by another account'), { status: 409 });
  }
  const existingParent = matches[0];
  if (existingParent) {
    await User.updateOne({ _id: existingParent._id }, { $addToSet: { childStudentIds: student._id } });
    return existingParent;
  }

  const parentDetails = student.parentDashboardPhoneType === 'father'
    ? student.fatherDetails
    : student.motherDetails;
  const name = parentDetails?.name ||
    (student.parentDashboardPhoneType === 'father' ? student.fatherName : student.motherName) ||
    `Parent of ${student.name}`;
  return User.create({
    name,
    email: internalEmail(phone),
    phone,
    passwordHash: await bcrypt.hash(initialPassword(schoolCode, student.dateOfBirth), 10),
    role: 'parent',
    childStudentIds: [student._id],
  });
}

module.exports = { initialPassword, publicEmail, provisionForStudent };
