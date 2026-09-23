const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const platform = require('../tenancy/platform');
const databases = require('../tenancy/connections');
const billing = require('../tenancy/billing');
const { fail } = require('../tenancy/access');
const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const logoUploadDir = path.join(__dirname, '../../uploads/school-logos');
fs.mkdirSync(logoUploadDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, logoUploadDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for school logos'));
    }
  },
});
const text = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} is required (maximum ${max} characters)`);
  return value.trim();
};
const code = value => { const result = text(value, 'Code', 40).toLowerCase(); if (!/^[a-z0-9][a-z0-9-]*$/.test(result)) fail(400, 'Use letters, numbers and hyphens for codes'); return result; };
function buildMongoUri(baseUri, dbName) {
  if (!baseUri) return '';
  const trimmed = baseUri.trim();
  const queryIndex = trimmed.indexOf('?');
  const queryParams = queryIndex !== -1 ? trimmed.slice(queryIndex) : '';
  const urlWithoutQuery = queryIndex !== -1 ? trimmed.slice(0, queryIndex) : trimmed;
  const schemeMatch = urlWithoutQuery.match(/^([a-zA-Z0-9+]+:\/\/)(.*)$/);
  if (!schemeMatch) return `${urlWithoutQuery.replace(/\/+$/, '')}/${dbName}${queryParams}`;
  const prefix = schemeMatch[1];
  const rest = schemeMatch[2];
  const slashIndex = rest.indexOf('/');
  if (slashIndex === -1) return `${prefix}${rest}/${dbName}${queryParams}`;
  const hostPart = rest.slice(0, slashIndex);
  return `${prefix}${hostPart}/${dbName}${queryParams}`;
}
const attempts = new Map();
function ownerSession(owner) {
  return { token: jwt.sign({ id: owner._id, role: 'owner', scope: 'owner', version: owner.tokenVersion || 0 }, process.env.JWT_SECRET, { expiresIn: '8h' }), user: { name: owner.name, email: owner.email, role: 'owner' } };
}
const ownerLogin = wrap(async (req, res) => {
  const key = req.ip;
  const now = Date.now();
  let attempt = attempts.get(key);
  if (!attempt || attempt.until < now) { attempt = { count: 0, until: now + 15 * 60000 }; attempts.set(key, attempt); }
  if (++attempt.count > 20) fail(429, 'Too many login attempts. Try again in 15 minutes.');
  if (attempts.size > 10000) for (const [k,v] of attempts) if (v.until < now) attempts.delete(k);
  const owner = await platform.get().Owner.findOne({ email: String(req.body.email || '').trim().toLowerCase(), active: true });
  if (!owner || typeof req.body.password !== 'string' || !await bcrypt.compare(req.body.password, owner.passwordHash)) fail(401, 'Invalid email or password');
  attempts.delete(key);
  res.json(ownerSession(owner));
});
router.post('/login', ownerLogin);
router.use(async (req, res, next) => {
  try {
    let claims;
    try { claims = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), process.env.JWT_SECRET); }
    catch (_) { return res.status(401).json({ message: 'Invalid or expired owner token' }); }
    if (claims.scope !== 'owner' || claims.role !== 'owner' || !await platform.get().Owner.exists({ _id: claims.id, active: true, tokenVersion: claims.version })) fail(403, 'Owner administrator access required');
    req.owner = claims; next();
  } catch (error) { next(error); }
});
router.post('/upload-logo', logoUpload.single('logo'), wrap(async (req, res) => {
  if (!req.file) fail(400, 'Logo image file is required');
  res.status(201).json({
    fileName: req.file.originalname,
    logoUrl: `/uploads/school-logos/${req.file.filename}`,
  });
}));
router.put('/password', wrap(async (req, res) => {
  const owner = await platform.get().Owner.findById(req.owner.id);
  if (typeof req.body.currentPassword !== 'string' || !await bcrypt.compare(req.body.currentPassword, owner.passwordHash)) fail(400, 'Current password is incorrect');
  if (typeof req.body.newPassword !== 'string' || req.body.newPassword.length < 12 || req.body.newPassword.length > 72) fail(400, 'New password must contain 12 to 72 characters');
  owner.passwordHash = await bcrypt.hash(req.body.newPassword, 12); owner.tokenVersion++;
  await owner.save(); res.json({ message: 'Password updated' });
}));
router.get('/invoices', wrap(async (req, res) => {
  res.json(await platform.get().Invoice.find().populate('schoolId', 'name code').sort({ createdAt: -1 }));
}));
router.get('/schools', wrap(async (req, res) => {
  const { School, Branch, Invoice } = platform.get();
  const schools = await School.find().sort({ createdAt: -1 }).lean();
  const branches = await Branch.find().lean();
  const overdue = await Invoice.distinct('schoolId', { status: 'unpaid', dueAt: { $lt: new Date() } });
  const blocked = new Set(overdue.map(String));
  res.json(schools.map(s => ({ ...s, overdue: blocked.has(String(s._id)), branches: branches.filter(b => String(b.schoolId) === String(s._id)) })));
}));
async function databaseKey(uri) {
  if (typeof uri !== 'string' || uri.length > 4096) fail(400, 'MongoDB URL is required');
  const key = await databases.probe(uri);
  const platformConnection = platform.connection();
  const controlKey = await databases.fingerprint(platformConnection);
  if (key === controlKey || await platform.get().Branch.exists({ databaseKey: key })) fail(409, 'This database is already assigned. Every branch requires its own database.');
  return key;
}
router.post('/schools', wrap(async (req, res) => {
  const { School, Branch, Principal } = platform.get();
  const b = req.body;
  const name = text(b.name, 'School name'); const schoolCode = code(b.code);
  if (await School.exists({ code: schoolCode })) fail(409, 'School code is already in use. Choose a unique code.');
  const inputs = b.branches ?? [{ name: b.branchName, code: b.branchCode, mongoUri: b.mongoUri, isMain: true }];
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 50) fail(400, 'Add between 1 and 50 branches');
  if (inputs.some(x => !x || typeof x.isMain !== 'boolean') || inputs.filter(x => x.isMain).length !== 1) fail(400, 'Choose exactly one main branch');
  const branchCodes = new Set();
  const keys = new Set();
  const branches = [];
  for (const input of inputs) {
    const name = text(input.name, 'Branch name'); const branchCode = code(input.code);
    if (branchCodes.has(branchCode)) fail(400, 'Branch codes must be unique within the school');
    branchCodes.add(branchCode);
    const dbName = input.isMain ? schoolCode : `${schoolCode}-${branchCode}`;
    const defaultUri = buildMongoUri(process.env.MONGODB_URI, dbName);
    const uri = (typeof input.mongoUri === 'string' && input.mongoUri.trim()) ? input.mongoUri.trim() : defaultUri;

    const key = await databaseKey(uri);
    if (keys.has(key)) fail(409, 'Each branch must have a separate database');
    keys.add(key);
    branches.push({ name, code: branchCode, isMain: input.isMain, databaseKey: key, encryptedUri: databases.encrypt(uri) });
  }
  const subscription = b.subscription ? billing.subscription(b.subscription, req.owner.id) : undefined;
  const principalName = text(b.principalName, 'Principal name');
  const email = text(b.principalEmail, 'Principal email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid principal email');
  if (typeof b.principalPassword !== 'string' || b.principalPassword.length < 12 || b.principalPassword.length > 72) fail(400, 'Principal password must contain 12 to 72 characters');
  const passwordHash = await bcrypt.hash(b.principalPassword, 12);
  const logoUrl = (typeof b.logoUrl === 'string' && b.logoUrl.trim()) ? b.logoUrl.trim() : '';
  const session = await platform.connection().startSession();
  let school;
  try { await session.withTransaction(async () => {
    [school] = await School.create([{ name, code: schoolCode, logoUrl, subscription }], { session });
    await Branch.create(branches.map(branch => ({ ...branch, schoolId: school._id })), { session, ordered: true });
    await Principal.create([{ schoolId: school._id, name: principalName, email, passwordHash }], { session });
    await billing.notify(school, `school:${school._id}`, `${name}: school subscription created`,
      `School ${name} (${schoolCode}) has been created with ${branches.length} branches.\n${subscription ? `Cycle: ${subscription.cycle}\nCycle price: INR ${subscription.cycleAmountMinor / 100}\nMonthly maintenance: INR ${subscription.monthlyMaintenanceMinor / 100}\nFirst bill: ${subscription.firstBillingDate}\nBills are due 15 days after generation.` : 'Subscription billing has not been configured.'}`, session);
  }); } finally { await session.endSession(); }
  res.status(201).json(school);
}));
router.put('/schools/:id/subscription', wrap(async (req, res) => {
  const subscription = billing.subscription(req.body, req.owner.id);
  const session = await platform.connection().startSession();
  let school;
  try { await session.withTransaction(async () => {
    school = await platform.get().School.findById(req.params.id).session(session);
    if (!school) fail(404, 'School not found');
    if (await platform.get().Invoice.exists({ schoolId: school._id, billingDate: { $gte: subscription.firstBillingDate } }).session(session)) fail(409, 'Choose a first billing date after the last generated subscription bill');
    school.subscription = subscription;
    await school.save({ session });
    await billing.notify(school, `subscription:${school._id}:${crypto.randomUUID()}`, `${school.name}: subscription updated`,
      `Cycle: ${subscription.cycle}\nCycle price: INR ${subscription.cycleAmountMinor / 100}\nMonthly maintenance: INR ${subscription.monthlyMaintenanceMinor / 100}\nFirst bill: ${subscription.firstBillingDate}\nBills are due 15 days after generation.`, session);
  }); } finally { await session.endSession(); }
  res.json(school);
}));
router.patch('/schools/:id', wrap(async (req, res) => {
  const update = {};
  if (req.body.name !== undefined) update.name = text(req.body.name, 'School name');
  if (req.body.logoUrl !== undefined) update.logoUrl = typeof req.body.logoUrl === 'string' ? req.body.logoUrl.trim() : '';
  if (req.body.active !== undefined) { if (typeof req.body.active !== 'boolean') fail(400, 'Invalid active status'); update.active = req.body.active; }
  const school = await platform.get().School.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  if (!school) fail(404, 'School not found'); res.json(school);
}));
router.post('/schools/:id/branches', wrap(async (req, res) => {
  const { School, Branch } = platform.get();
  const school = await School.findById(req.params.id);
  if (!school) fail(404, 'School not found');
  const name = text(req.body.name, 'Branch name'); const branchCode = code(req.body.code);
  const dbName = `${school.code}-${branchCode}`;
  const defaultUri = buildMongoUri(process.env.MONGODB_URI, dbName);
  const uri = (typeof req.body.mongoUri === 'string' && req.body.mongoUri.trim()) ? req.body.mongoUri.trim() : defaultUri;
  const key = await databaseKey(uri);
  const branch = await Branch.create({ schoolId: req.params.id, name, code: branchCode, databaseKey: key, encryptedUri: databases.encrypt(uri) });
  res.status(201).json({ _id: branch._id, schoolId: branch.schoolId, name, code: branchCode, active: branch.active });
}));
router.patch('/schools/:id/branches/:branchId', wrap(async (req, res) => {
  const update = {};
  if (req.body.name !== undefined) update.name = text(req.body.name, 'Branch name');
  if (req.body.active !== undefined) { if (typeof req.body.active !== 'boolean') fail(400, 'Invalid active status'); update.active = req.body.active; }
  const branch = await platform.get().Branch.findOneAndUpdate({ _id: req.params.branchId, schoolId: req.params.id }, { $set: update }, { new: true, runValidators: true });
  if (!branch) fail(404, 'Branch not found'); res.json(branch);
}));
router.get('/schools/:id/invoices', wrap(async (req, res) => {
  res.json(await platform.get().Invoice.find({ schoolId: req.params.id }).sort({ createdAt: -1 }));
}));
function dueAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Due date must be YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00Z`);
  if (isNaN(date) || date.toISOString().slice(0, 10) !== value) fail(400, 'Invalid due date');
  return new Date(`${value}T23:59:59.999+05:30`);
}
router.post('/schools/:id/invoices', wrap(async (req, res) => {
  const school = await platform.get().School.findById(req.params.id);
  if (!school) fail(404, 'School not found');
  const { amountMinor, description, dueDate } = req.body;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 100000000000) fail(400, 'Enter a valid positive amount in paise');
  const session = await platform.connection().startSession();
  let invoice;
  try { await session.withTransaction(async () => {
  [invoice] = await platform.get().Invoice.create([{ schoolId: req.params.id,
    number: `INV-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    amountMinor, description: text(description, 'Description', 1000), dueDate, dueAt: dueAt(dueDate), createdBy: req.owner.id, updatedBy: req.owner.id }], { session });
  await billing.invoiceNotice(school, invoice, session);
  }); } finally { await session.endSession(); }
  res.status(201).json(invoice);
}));
router.patch('/schools/:id/invoices/:invoiceId', wrap(async (req, res) => {
  if (!['paid', 'void'].includes(req.body.status)) fail(400, 'Choose paid or void');
  const paymentReference = text(req.body.paymentReference, req.body.status === 'paid' ? 'Payment reference' : 'Void reason', 200);
  const session = await platform.connection().startSession();
  let invoice;
  try { await session.withTransaction(async () => {
    invoice = await platform.get().Invoice.findOneAndUpdate({ _id: req.params.invoiceId, schoolId: req.params.id, status: 'unpaid' },
      { $set: { status: req.body.status, paymentReference, paidAt: req.body.status === 'paid' ? new Date() : null, updatedBy: req.owner.id } }, { new: true, session });
    if (!invoice) fail(409, 'Invoice not found or already settled');
    const school = await platform.get().School.findById(req.params.id).session(session);
    await billing.invoiceNotice(school, invoice, session);
  }); } finally { await session.endSession(); }
  res.json(invoice);
}));
router.get('/schools/:id/logs', wrap(async (req, res) => {
  const { School, Branch } = platform.get();
  const school = await School.findById(req.params.id);
  if (!school) fail(404, 'School not found');

  const branchFilter = { schoolId: school._id };
  if (req.query.branchId) {
    branchFilter._id = req.query.branchId;
  }
  const branches = await Branch.find(branchFilter).select('+encryptedUri');
  if (!branches.length) {
    return res.json({ school: { id: school._id, name: school.name, code: school.code }, items: [], total: 0, page: 1, limit: 50, totalPages: 1 });
  }

  const { runBranch } = require('../tenancy/access');
  const AuditLog = require('../models/AuditLog');

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const { entityType, action, role, search, startDate, endDate } = req.query;

  const logFilter = {};
  if (entityType) {
    if (entityType.includes(',')) {
      logFilter.entityType = { $in: entityType.split(',').map(s => s.trim()).filter(Boolean) };
    } else {
      logFilter.entityType = entityType.trim();
    }
  }
  if (action) {
    if (action.includes(',')) {
      logFilter.action = { $in: action.split(',').map(s => s.trim()).filter(Boolean) };
    } else {
      logFilter.action = action.trim();
    }
  }
  if (role) logFilter['performedBy.role'] = role.trim();

  if (startDate || endDate) {
    logFilter.createdAt = {};
    if (startDate) {
      const s = new Date(startDate);
      if (!isNaN(s)) logFilter.createdAt.$gte = s;
    }
    if (endDate) {
      const e = new Date(endDate);
      if (!isNaN(e)) {
        e.setHours(23, 59, 59, 999);
        logFilter.createdAt.$lte = e;
      }
    }
  }

  if (search && search.trim()) {
    const q = search.trim();
    logFilter.$or = [
      { note: { $regex: q, $options: 'i' } },
      { 'performedBy.name': { $regex: q, $options: 'i' } },
      { 'performedBy.email': { $regex: q, $options: 'i' } },
      { entityType: { $regex: q, $options: 'i' } },
    ];
  }

  // Fetch logs from each target branch
  const branchResults = await Promise.all(
    branches.map(async (branch) => {
      try {
        return await runBranch(school, branch, async () => {
          const [items, total] = await Promise.all([
            AuditLog.find(logFilter).sort({ createdAt: -1 }).limit(page * limit).lean(),
            AuditLog.countDocuments(logFilter),
          ]);
          return {
            items: items.map(log => ({
              ...log,
              branchId: branch._id,
              branchName: branch.name,
              branchCode: branch.code,
            })),
            total,
          };
        });
      } catch (err) {
        console.error(`Failed to fetch logs for branch ${branch.code}`, err);
        return { items: [], total: 0 };
      }
    })
  );

  const combinedItems = branchResults.flatMap(r => r.items);
  const totalCount = branchResults.reduce((acc, r) => acc + r.total, 0);

  // Sort descending by timestamp
  combinedItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pagedItems = combinedItems.slice((page - 1) * limit, page * limit);

  res.json({
    school: { id: school._id, name: school.name, code: school.code },
    items: pagedItems,
    total: totalCount,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
  });
}));

module.exports = router;
module.exports.dueAt = dueAt;
module.exports.sharedLogin = async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email && await platform.get().Owner.exists({ email })) return ownerLogin(req, res, next);
    next();
  } catch (error) { next(error); }
};
