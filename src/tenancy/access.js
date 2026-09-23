const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const platform = require('./platform');
const { acquire } = require('./connections');
const { storage } = require('./context');
const User = require('../models/User');

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function checkSchool(school, branch) {
  if (!school || !school.active || !branch || !branch.active || String(branch.schoolId) !== String(school._id)) fail(403, 'School or branch access is disabled');
  if (await platform.get().Invoice.exists({ schoolId: school._id, status: 'unpaid', dueAt: { $lt: new Date() } })) fail(402, 'ERP access is suspended because a school bill is overdue. Please contact the school administrator.');
}
async function runBranch(school, branch, task) {
  const lease = await acquire(branch);
  try { return await storage.run({ connection: lease.connection, school, branch }, task); }
  finally { lease.release(); }
}
async function loginBranch(school, body) {
  if (!school) return null;
  const { Branch, Principal } = platform.get();
  // Keep explicit branch selection compatible with older clients.
  if (body.branchCode) return Branch.findOne({ schoolId: school._id, code: String(body.branchCode).trim().toLowerCase() }).select('+encryptedUri');
  const branches = await Branch.find({ schoolId: school._id, active: true }).sort({ isMain: -1, createdAt: 1, _id: 1 }).select('+encryptedUri');
  await checkSchool(school, branches[0]);
  if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email.trim() || !body.password) fail(400, 'Email/mobile and password are required');
  const identifier = body.email.trim();
  if (await Principal.exists({ schoolId: school._id, email: identifier.toLowerCase() })) return branches[0];
  for (const branch of branches) {
    const matches = await runBranch(school, branch, async () => {
      const user = await User.findOne({ active: true, $or: [{ email: identifier.toLowerCase() }, { phone: identifier }] });
      return user && await bcrypt.compare(body.password, user.passwordHash);
    });
    if (matches) return branch;
  }
  fail(401, 'Invalid email or password');
}
async function gate(req, res, next) {
  try {
    const { School, Branch, Principal } = platform.get();
    let school, branch, claims;
    if (req.path === '/auth/login' && req.method === 'POST') {
      const schoolCode = String(req.body.schoolCode || 'legacy').trim().toLowerCase();
      school = await School.findOne({ code: schoolCode });
      branch = await loginBranch(school, req.body);
    } else {
      const header = req.headers.authorization || '';
      try { claims = jwt.verify(header.startsWith('Bearer ') ? header.slice(7) : '', process.env.JWT_SECRET); }
      catch (_) { return res.status(401).json({ message: 'Invalid or expired token' }); }
      if (claims.scope === 'owner' || claims.role === 'owner') fail(403, 'Owner accounts cannot access branch records');
      if (claims.schoolId && claims.branchId) {
        school = await School.findById(claims.schoolId);
        branch = await Branch.findById(claims.branchId).select('+encryptedUri');
      } else {
        school = await School.findOne({ code: 'legacy' });
        branch = school && await Branch.findOne({ schoolId: school._id, legacy: true }).select('+encryptedUri');
      }
      if (claims.principalId && !await Principal.exists({ _id: claims.principalId, schoolId: school?._id, active: true })) fail(403, 'Principal account is disabled');
    }
    await checkSchool(school, branch);
    const lease = await acquire(branch);
    let released = false;
    const release = () => { if (!released) { released = true; lease.release(); } };
    res.once('finish', release); res.once('close', release);
    await storage.run({ connection: lease.connection, school, branch }, async () => {
      if (claims && !await User.exists({ _id: claims.id, role: claims.role, active: true })) fail(401, 'Account is unavailable');
      req.tenant = { school, branch };
      next();
    });
  } catch (error) { next(error); }
}
async function principalUser(principal) {
  const existing = await User.findOne({ email: principal.email });
  if (existing && existing.role !== 'principal') fail(409, 'Principal email is already used by another account in this branch');
  return User.findOneAndUpdate({ email: principal.email }, { $set: {
    name: principal.name, passwordHash: principal.passwordHash, role: 'principal', active: true,
    platformPrincipalId: principal._id,
  } }, { upsert: true, new: true, runValidators: true });
}
async function authenticatePrincipal(email, password) {
  const scope = storage.getStore();
  if (!scope) return null;
  const principal = await platform.get().Principal.findOne({ schoolId: scope.school._id, email: email.toLowerCase() });
  if (!principal) return null;
  if (!principal.active || !await bcrypt.compare(password, principal.passwordHash)) fail(401, 'Invalid email or password');
  return principalUser(principal);
}
async function linkLegacyPrincipal(user) {
  const scope = storage.getStore();
  if (!scope || !scope.branch.legacy || user.role !== 'principal') return;
  const principal = await platform.get().Principal.findOneAndUpdate({ schoolId: scope.school._id, email: user.email },
    { $setOnInsert: { name: user.name, passwordHash: user.passwordHash } }, { upsert: true, new: true });
  if (!principal.active) fail(403, 'Principal account is disabled');
  user.platformPrincipalId = principal._id; await user.save();
}
function sign(user) {
  const scope = storage.getStore();
  return jwt.sign({ id: user._id, role: user.role, ...(scope ? {
    schoolId: scope.school._id, branchId: scope.branch._id, schoolName: scope.school.name,
    branchName: scope.branch.name, principalId: user.platformPrincipalId,
  } : {}) }, process.env.JWT_SECRET, { expiresIn: '7d' });
}
module.exports = { fail, checkSchool, runBranch, gate, principalUser, authenticatePrincipal, linkLegacyPrincipal, sign };
