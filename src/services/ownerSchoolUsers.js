const mongoose = require('mongoose');
const platform = require('../tenancy/platform');
const { runBranch, fail } = require('../tenancy/access');
const { connection } = require('../tenancy/context');
const User = require('../models/User');
const Staff = require('../models/Staff');
const Teacher = require('../models/Teacher');
const { Driver } = require('../models/Transport');

const roles = ['principal', 'teacher', 'staff', 'parent', 'driver'];
const id = value => mongoose.isValidObjectId(value) && /^[a-f\d]{24}$/i.test(value);
const compact = value => String(value || '').trim();
function name(value, label, max = 200) {
  const result = compact(value);
  if (!result || result.length > max) fail(400, `${label} must be 1-${max} characters`);
  return result;
}
function email(value) {
  const result = name(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, 'Enter a valid email address');
  return result;
}
function phone(value, required) {
  const result = compact(value);
  if (required && !result) fail(400, 'Phone is required for this account');
  if (result && !/^\+?[0-9]{7,15}$/.test(result)) fail(400, 'Phone must contain 7-15 digits');
  return result;
}
function changes(input, role) {
  if (!input || Array.isArray(input) || typeof input !== 'object' ||
      !Object.keys(input).length || Object.keys(input).some(key => !['name', 'email', 'phone', 'active'].includes(key))) {
    fail(400, 'Only name, email, phone and active status can be changed here');
  }
  const value = {};
  if (input.name !== undefined) value.name = name(input.name, 'Name');
  if (input.email !== undefined) value.email = email(input.email);
  if (input.phone !== undefined) value.phone = phone(input.phone, ['teacher', 'staff', 'driver'].includes(role));
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') fail(400, 'Active status must be true or false');
    value.active = input.active;
  }
  return value;
}
async function schoolAndBranches(schoolId) {
  if (!id(schoolId)) fail(400, 'Invalid school ID');
  const { School, Branch } = platform.get();
  const school = await School.findById(schoolId).select('_id name');
  if (!school) fail(404, 'School not found');
  const branches = await Branch.find({ schoolId }).select('+encryptedUri').sort({ name: 1, _id: 1 });
  return { school, branches };
}
function branchFor(branches, branchId) {
  if (!id(branchId)) fail(400, 'Invalid branch ID');
  const branch = branches.find(item => String(item._id) === branchId);
  if (!branch) fail(404, 'Branch not found in this school');
  return branch;
}
const publicUser = (user, branch) => ({
  id: String(user._id), branchId: branch ? String(branch._id) : null,
  branchName: branch?.name || 'All branches', name: user.name,
  email: user.email, phone: user.phone || '', role: user.role || 'principal', active: user.active !== false,
});
async function list(schoolId, query = {}) {
  const { school, branches } = await schoolAndBranches(schoolId);
  const page = Number(query.page || 1), limit = Number(query.limit || 20);
  if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'Invalid page or limit');
  const role = query.role || 'all';
  if (role !== 'all' && !roles.includes(role)) fail(400, 'Invalid role');
  const search = compact(query.search);
  if (search.length > 100) fail(400, 'Search is too long');
  const regex = search && new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const searchFilter = regex ? { $or: [{ name: regex }, { email: regex }, { phone: regex }] } : {};
  const selected = query.branchId ? [branchFor(branches, query.branchId)] : branches;
  const items = []; let total = 0, offset = (page - 1) * limit;
  if (role === 'all' || role === 'principal') {
    const filter = { schoolId: school._id, ...searchFilter };
    const count = await platform.get().Principal.countDocuments(filter);
    total += count;
    if (offset < count && items.length < limit) {
      const principals = await platform.get().Principal.find(filter).select('_id name email phone active').sort({ name: 1, _id: 1 }).skip(offset).limit(limit - items.length).lean();
      items.push(...principals.map(user => publicUser(user, null)));
    }
    offset = Math.max(0, offset - count);
  }
  if (role !== 'principal') {
    const filter = { role: role === 'all' ? { $ne: 'principal' } : role, ...searchFilter };
    for (const branch of selected) {
      const count = await runBranch(school, branch, () => User.countDocuments(filter));
      total += count;
      if (offset < count && items.length < limit) {
        const users = await runBranch(school, branch, () => User.find(filter)
          .select('_id name email phone role active').sort({ name: 1, _id: 1 }).skip(offset).limit(limit - items.length).lean());
        items.push(...users.map(user => publicUser(user, branch)));
      }
      offset = Math.max(0, offset - count);
    }
  }
  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
async function updateBranch(schoolId, branchId, userId, input) {
  const { school, branches } = await schoolAndBranches(schoolId);
  const branch = branchFor(branches, branchId);
  if (!id(userId)) fail(400, 'Invalid user ID');
  return runBranch(school, branch, async () => {
    const session = await connection().startSession();
    let result;
    try { await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      if (!user || user.role === 'principal') fail(404, 'User not found in this branch');
      const patch = changes(input, user.role);
      const nextPhone = patch.phone ?? user.phone;
      if (nextPhone && patch.phone !== undefined && await User.exists({ _id: { $ne: user._id }, phone: nextPhone }).session(session)) fail(409, 'Phone is already used in this branch');
      Object.assign(user, patch);
      await user.save({ session });
      const Profile = user.role === 'staff' ? Staff : user.role === 'teacher' ? Teacher : user.role === 'driver' ? Driver : null;
      if (Profile) {
        const profile = await Profile.findOne({ userId: user._id }).session(session);
        if (profile) {
          if (patch.name !== undefined) profile.name = patch.name;
          if (patch.email !== undefined) profile.email = patch.email;
          if (patch.phone !== undefined) profile.phone = patch.phone;
          if (patch.active !== undefined) {
            if (user.role === 'driver') profile.active = patch.active;
            else profile.status = patch.active ? 'active' : 'inactive';
          }
          await profile.save({ session });
        }
      }
      result = publicUser(user, branch);
    }); } finally { await session.endSession(); }
    return result;
  });
}
async function updatePrincipal(schoolId, principalId, input) {
  const { school, branches } = await schoolAndBranches(schoolId);
  if (!id(principalId)) fail(400, 'Invalid principal ID');
  const patch = changes(input, 'principal');
  const { Principal } = platform.get();
  const principal = await Principal.findOne({ _id: principalId, schoolId: school._id });
  if (!principal) fail(404, 'Principal not found in this school');
  if (patch.email !== undefined && patch.email !== principal.email) {
    if (await Principal.exists({ schoolId: school._id, email: patch.email, _id: { $ne: principal._id } })) fail(409, 'Email is already used by another principal');
    for (const branch of branches) {
      const conflict = await runBranch(school, branch, () => User.exists({ email: patch.email, platformPrincipalId: { $ne: principal._id } }));
      if (conflict) fail(409, `Email is already used in ${branch.name}`);
    }
  }
  Object.assign(principal, patch);
  await principal.save();
  return publicUser(principal, null);
}
module.exports = { list, updateBranch, updatePrincipal };
