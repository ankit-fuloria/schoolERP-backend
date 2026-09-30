const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const platform = require('./platform');
const { acquire } = require('./connections');
const { storage } = require('./context');
const User = require('../models/User');
const accountPhone = require('../utils/accountPhone');

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function checkSchool(school, branch) {
  const status = await require('../services/ownerBilling').schoolStatus(school, branch);
  if (status !== 'active') throw Object.assign(new Error(status === 'disabled' ? 'Contact the administrator to activate your ERP.' : 'A school payment is overdue. ERP access is suspended.'), { status: status === 'disabled' ? 403 : 402, code: status === 'disabled' ? 'SCHOOL_DISABLED' : 'BILLING_OVERDUE' });
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
  const branches = await Branch.find({ schoolId: school._id }).sort({ isMain: -1, createdAt: 1, _id: 1 }).select('+encryptedUri');
  if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email.trim() || !body.password) fail(400, 'Email/mobile and password are required');
  const identifier = body.email.trim();
  const phone = accountPhone.pattern(identifier);
  const loginFilter = { $or: [{ email: identifier.toLowerCase() }, ...(phone ? [{ phone }] : [])] };
  const principal = await Principal.findOne({ schoolId: school._id, ...loginFilter });
  if (principal) {
    if (await bcrypt.compare(body.password, principal.passwordHash)) {
      if (!principal.active) fail(401, 'Invalid email or password');
      return branches[0];
    }
    if (principal.email === identifier.toLowerCase()) fail(401, 'Invalid email or password');
  }
  await checkSchool(school, branches.find(b => b.active));
  for (const branch of branches.filter(b => b.active)) {
    const matches = await runBranch(school, branch, async () => {
      const users = await User.find({ active: true, ...loginFilter });
      for (const user of users) if (await bcrypt.compare(body.password, user.passwordHash)) return true;
      return false;
    });
    if (matches) return branch;
  }
  fail(401, 'Invalid email/phone number or password');
}
async function gate(req, res, next) {
  try {
    const { School, Branch, Principal } = platform.get();
    let school, branch, claims;
    if (req.path === '/auth/login' && req.method === 'POST') {
      const schoolCode = String(req.body.schoolCode || 'legacy').trim();
      school = await School.findOne({ code: new RegExp(`^${schoolCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
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
        school = await School.findOne({ code: /^legacy$/i });
        branch = school && await Branch.findOne({ schoolId: school._id, legacy: true }).select('+encryptedUri');
      }
      if (claims.principalId && !await Principal.exists({ _id: claims.principalId, schoolId: school?._id, active: true })) fail(403, 'Principal account is disabled');
    }
    const schoolAccess = await require('../services/ownerBilling').schoolStatus(school, branch);
    let principalLogin = false;
    if (req.path === '/auth/login' && req.method === 'POST' && school) {
      const identifier = String(req.body.email || '').trim();
      const phone = accountPhone.pattern(identifier);
      const principal = await Principal.findOne({ schoolId: school._id, active: true,
        $or: [{ email: identifier.toLowerCase() }, ...(phone ? [{ phone }] : [])] });
      principalLogin = Boolean(principal && typeof req.body.password === 'string' && await bcrypt.compare(req.body.password, principal.passwordHash));
    }
    const principalBilling = claims?.role === 'principal' && req.method === 'GET' && req.path === '/dashboard/billing';
    if (schoolAccess !== 'active' && !principalLogin && !principalBilling) {
      const code = schoolAccess === 'disabled' ? 'SCHOOL_DISABLED' : 'BILLING_OVERDUE';
      return res.status(schoolAccess === 'disabled' ? 403 : 402).json({ code, message: claims?.role === 'principal' ? (schoolAccess === 'disabled' ? 'Contact the administrator to activate your ERP.' : 'A school payment is overdue. ERP access is suspended.') : 'Something went wrong. Please try again later.' });
    }
    if (!school || !branch || String(branch.schoolId) !== String(school._id)) fail(403, 'Something went wrong. Please try again later.');
    const lease = await acquire(branch);
    let released = false;
    const release = () => { if (!released) { released = true; lease.release(); } };
    res.once('finish', release); res.once('close', release);
    await storage.run({ connection: lease.connection, school, branch }, async () => {
      if (claims && !await User.exists({ _id: claims.id, role: claims.role, active: true })) fail(401, 'Account is unavailable');
      req.tenant = { school, branch, schoolAccess };
      next();
    });
  } catch (error) {
    if (['SCHOOL_DISABLED', 'BILLING_OVERDUE'].includes(error.code)) return res.status(error.status).json({ code: error.code, message: 'Something went wrong. Please try again later.' });
    next(error);
  }
}
async function principalUser(principal) {
  const existing = await User.findOne({ platformPrincipalId: principal._id }) || await User.findOne({ email: principal.email });
  if (existing && existing.role !== 'principal') fail(409, 'Principal email is already used by another account in this branch');
  return User.findOneAndUpdate(existing ? { _id: existing._id } : { email: principal.email }, { $set: {
    name: principal.name, email: principal.email, phone: principal.phone,
    passwordHash: principal.passwordHash, role: 'principal', active: principal.active,
    platformPrincipalId: principal._id,
  } }, { upsert: true, new: true, runValidators: true });
}
async function authenticatePrincipal(email, password) {
  const scope = storage.getStore();
  if (!scope) return null;
  const phone = accountPhone.pattern(email);
  const principal = await platform.get().Principal.findOne({ schoolId: scope.school._id,
    $or: [{ email: email.toLowerCase() }, ...(phone ? [{ phone }] : [])] });
  if (!principal) return null;
  if (!await bcrypt.compare(password, principal.passwordHash)) {
    if (principal.email === email.toLowerCase()) fail(401, 'Invalid email or password');
    return null;
  }
  if (!principal.active) fail(401, 'Invalid email or password');
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
