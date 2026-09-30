const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const platform = require('../src/tenancy/platform');
const databases = require('../src/tenancy/connections');
const { storage, connection } = require('../src/tenancy/context');
const { gate, runBranch } = require('../src/tenancy/access');
const User = require('../src/models/User');
const Teacher = require('../src/models/Teacher');
const SchoolClass = require('../src/models/SchoolClass');
const Student = require('../src/models/Student');
let mongo, app, ownerToken, school, branchA, branchB, otherBranch, principalToken;
const password = 'Test-Principal-123!';
const call = (method, path, body, token = ownerToken) => {
  const req = request(app)[method](path); if (token) req.set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};
before(async () => {
  process.env.JWT_SECRET = 'test-tenancy-secret';
  process.env.TENANT_DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.OWNER_DB_NAME = 'schoolo_platform_test';
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri('legacy_data');
  await mongoose.connect(process.env.MONGODB_URI);
  await require('../src/tenancy/initialize')();
  await platform.get().Owner.create({ email: 'owner@example.com', name: 'Test Owner', passwordHash: await bcrypt.hash(password, 4) });
  app = express(); app.use(express.json());
  app.use('/api/owner', require('../src/routes/ownerRoutes'));
  app.post('/api/auth/login', require('../src/routes/ownerRoutes').sharedLogin);
  app.use('/api', gate);
  app.use('/api/auth', require('../src/routes/authRoutes'));
  app.use('/api/parents', require('../src/routes/parentRoutes'));
  app.use('/api/teachers', require('../src/routes/teacherRoutes'));
  app.use('/api/branches', require('../src/routes/branchAccessRoutes'));
  app.get('/api/probe', async (req, res, next) => {
    try { await new Promise(r => setTimeout(r, Math.random() * 20)); res.json({ users: await User.find().select('name email role'), database: connection().name }); }
    catch (error) { next(error); }
  });
  app.use((error, req, res, next) => res.status(error.status || (error.code === 11000 ? 409 : error.name === 'CastError' ? 400 : 500)).json({ message: error.message }));
  ownerToken = (await call('post', '/api/owner/login', { email: 'owner@example.com', password }, null).expect(200)).body.token;
});
after(async () => { await databases.close(); await platform.close(); await mongoose.disconnect(); if (mongo) await mongo.stop(); });
test('owner exclusively creates schools, branches and encrypted database assignments', async () => {
  await call('get', '/api/owner/schools', undefined, null).expect(401);
  const payload = { name: 'Oak School', code: 'oak', branchName: 'North', branchCode: 'north', mongoUri: mongo.getUri('oak_north'), principalName: 'Principal', principalEmail: 'principal@oak.test', principalPhone: '9876543210', principalPassword: password };
  school = (await call('post', '/api/owner/schools', payload).expect(201)).body;
  assert.equal(school.code, 'OAK');
  await call('post', '/api/owner/schools', { name: 'Duplicate School', code: 'OaK' }).expect(409);
  await call('post', '/api/owner/schools', { name: 'Legacy Duplicate', code: 'LEGACY' }).expect(409);
  branchA = await platform.get().Branch.findOne({ schoolId: school._id }).select('+encryptedUri +databaseKey');
  assert.equal(databases.decrypt(branchA.encryptedUri), payload.mongoUri);
  assert.ok(!branchA.encryptedUri.includes('mongodb'));
  branchB = (await call('post', `/api/owner/schools/${school._id}/branches`, { name: 'South', code: 'south', mongoUri: mongo.getUri('oak_south') }).expect(res => assert.equal(res.status, 201, JSON.stringify(res.body)))).body;
  await call('post', `/api/owner/schools/${school._id}/branches`, { name: 'Duplicate', code: 'duplicate', mongoUri: payload.mongoUri }).expect(409);
  await call('post', `/api/owner/schools/${school._id}/branches`, { name: 'Alias', code: 'alias', mongoUri: payload.mongoUri.replace('127.0.0.1', 'localhost') }).expect(409);
  await call('post', `/api/owner/schools/${school._id}/branches`, { name: 'Control', code: 'control', mongoUri: mongo.getUri('schoolo_platform_test') }).expect(409);
  const response = await call('get', '/api/owner/schools').expect(res => assert.equal(res.status, 200, JSON.stringify(res.body)));
  assert.ok(!JSON.stringify(response.body).includes('encryptedUri'));
  assert.ok(!JSON.stringify(response.body).includes('databaseKey'));
  assert.ok(!JSON.stringify(response.body).includes('mongodb'));
});
test('principal login binds school and branch and switching is same-school only', async () => {
  const byPhone = await call('post', '/api/auth/login', { schoolCode: 'oak', email: '+91 98765 43210', password }, null).expect(200);
  assert.equal(byPhone.body.user.role, 'principal');
  await call('post', '/api/auth/login', { schoolCode: 'OAK', email: 'principal@oak.test', password }, null).expect(200);
  await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'north', email: '9876543210', password }, null).expect(200);
  principalToken = (await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'north', email: 'principal@oak.test', password }, null).expect(200)).body.token;
  const branches = (await call('get', '/api/branches', undefined, principalToken).expect(200)).body;
  assert.equal(branches.branches.length, 2);
  await call('get', '/api/owner/schools', undefined, principalToken).expect(403);
  await call('get', '/api/probe', undefined, ownerToken).expect(403);
  const other = (await call('post', '/api/owner/schools', { name: 'Elm School', code: 'elm', branchName: 'Main', branchCode: 'main', mongoUri: mongo.getUri('elm_main'), principalName: 'Other Principal', principalEmail: 'principal@elm.test', principalPhone: '9876543210', principalPassword: password }).expect(201)).body;
  otherBranch = await platform.get().Branch.findOne({ schoolId: other._id });
  await call('post', '/api/branches/switch', { branchId: otherBranch._id }, principalToken).expect(403);
  const switched = (await call('post', '/api/branches/switch', { branchId: branchB._id }, principalToken).expect(200)).body;
  assert.equal((await call('get', '/api/probe', undefined, switched.token).expect(200)).body.database, 'oak_south');
});
test('overlapping requests and populated references never cross branch databases', async () => {
  const south = await platform.get().Branch.findById(branchB._id).select('+encryptedUri');
  const teacherId = new mongoose.Types.ObjectId();
  const hash = await bcrypt.hash(password, 4);
  for (const [branch, name] of [[branchA, 'North Teacher'], [south, 'South Teacher']]) {
    await runBranch(school, branch, async () => {
      await User.create({ _id: teacherId, name, email: 'teacher@test.com', phone: '9990001234', passwordHash: hash, role: 'teacher' });
      const klass = await SchoolClass.create({ name, grade: '1st', section: 'A', gradeBand: 'Primary' });
      const student = await Student.create({ name: 'Test pupil', admissionNo: '001', classId: klass._id });
      assert.equal((await Student.findById(student._id).populate('classId')).classId.name, name);
      const session = await connection().startSession();
      try { await session.withTransaction(async () => { await SchoolClass.updateOne({ _id: klass._id }, { roomNo: '30' }, { session }); }); }
      finally { await session.endSession(); }
      assert.equal((await SchoolClass.findById(klass._id)).name, name);
      assert.equal((await SchoolClass.findById(klass._id)).roomNo, '30');
    });
  }
  const northToken = (await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'north', email: 'teacher@test.com', password }, null).expect(200)).body.token;
  const teacherByPhone = await call('post', '/api/auth/login', { schoolCode: 'oak', email: '+91 99900 01234', password }, null).expect(200);
  assert.equal(teacherByPhone.body.user.role, 'teacher');
  const southToken = (await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'south', email: 'teacher@test.com', password }, null).expect(200)).body.token;
  const requests = Array.from({ length: 20 }, (_, i) => call('get', '/api/probe', undefined, i % 2 ? southToken : northToken).expect(200));
  const results = await Promise.all(requests);
  results.forEach((r, i) => { assert.equal(r.body.database, i % 2 ? 'oak_south' : 'oak_north'); assert.equal(r.body.users.find(u => u.role === 'teacher').name, i % 2 ? 'South Teacher' : 'North Teacher'); });
  await call('post', '/api/branches/switch', { branchId: branchB._id }, northToken).expect(403);
  assert.equal(await User.countDocuments({ _id: teacherId }), 0);
});
test('school login resolves branches without a branch code and stays inside the school', async () => {
  const principal = await call('post', '/api/auth/login', { schoolCode: 'oak', email: 'principal@oak.test', password }, null).expect(200);
  assert.equal((await call('get', '/api/probe', undefined, principal.body.token).expect(200)).body.database, 'oak_north');
  const south = await platform.get().Branch.findById(branchB._id).select('+encryptedUri');
  await runBranch(school, south, async () => {
    await User.create({ name: 'South Parent', email: 'south-parent@test.com', phone: '1234567890', passwordHash: await bcrypt.hash(password, 4), role: 'parent' });
  });
  for (const email of ['south-parent@test.com', '1234567890']) {
    const response = await call('post', '/api/auth/login', { schoolCode: 'oak', email, password }, null).expect(200);
    assert.equal((await call('get', '/api/probe', undefined, response.body.token).expect(200)).body.database, 'oak_south');
  }
  await call('post', '/api/auth/login', { schoolCode: 'elm', email: 'south-parent@test.com', password }, null).expect(401);
  await call('post', '/api/auth/login', { schoolCode: 'oak', email: 'south-parent@test.com', password: 'wrong' }, null).expect(401);
  const repeated = await call('post', '/api/auth/login', { schoolCode: 'oak', email: 'teacher@test.com', password }, null).expect(200);
  assert.equal((await call('get', '/api/probe', undefined, repeated.body.token).expect(200)).body.database, 'oak_north');
});
test('new parent accounts require contact details and accept phone login', async () => {
  const north = await platform.get().Branch.findById(branchA._id).select('+encryptedUri');
  const child = await runBranch(school, north, () => Student.create({
    name: 'Parent login pupil', admissionNo: 'parent-phone-1', classId: new mongoose.Types.ObjectId(),
  }));
  const body = { name: 'Phone Parent', email: 'phone-parent@oak.test', password,
    childStudentIds: [String(child._id)] };
  await call('post', '/api/parents', body, principalToken).expect(400);
  await call('post', '/api/parents', { ...body, phone: '9988776655' }, principalToken).expect(201);
  const login = await call('post', '/api/auth/login', { schoolCode: 'oak', email: '+91 99887 76655', password }, null).expect(200);
  assert.equal(login.body.user.role, 'parent');
});
test('new teacher accounts require name, email and phone and accept phone login', async () => {
  const body = { firstName: 'New Teacher', subject: 'Art', email: 'new-art@oak.test',
    phone: '9977001122', password };
  for (const key of ['firstName', 'email', 'phone']) {
    await call('post', '/api/teachers', { ...body, [key]: '' }, principalToken).expect(400);
  }
  await call('post', '/api/teachers', body, principalToken).expect(201);
  const login = await call('post', '/api/auth/login', { schoolCode: 'oak', email: '+91 99770 01122', password }, null).expect(200);
  assert.equal(login.body.user.role, 'teacher');
});
test('overdue bills restrict principal logins to billing and block operational requests', async () => {
  const invoice = (await call('post', `/api/owner/schools/${school._id}/invoices`, { description: 'Annual ERP subscription', amountMinor: 100000, dueDate: '2020-01-01' }).expect(201)).body;
  await call('get', '/api/probe', undefined, principalToken).expect(402);
  assert.equal((await call('post', '/api/auth/login', { schoolCode: 'oak', email: 'principal@oak.test', password }, null).expect(200)).body.user.schoolAccess, 'overdue');
  assert.equal((await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'south', email: 'principal@oak.test', password }, null).expect(200)).body.user.schoolAccess, 'overdue');
  await call('get', '/api/owner/schools').expect(200);
  await call('patch', `/api/owner/schools/${school._id}/invoices/${invoice._id}`, { status: 'paid', paymentReference: 'TEST-RECEIPT' }).expect(res => assert.equal(res.status, 200, JSON.stringify(res.body)));
  await call('get', '/api/probe', undefined, principalToken).expect(200);
  await call('patch', `/api/owner/schools/${school._id}/invoices/${invoice._id}`, { status: 'void', paymentReference: 'Invalid retry' }).expect(409);
});
test('suspension is immediate and invoices validate actual dates and whole paise', async () => {
  await call('post', `/api/owner/schools/${school._id}/invoices`, { description: 'Bad date', amountMinor: 100, dueDate: '2026-02-30' }).expect(400);
  await call('post', `/api/owner/schools/${school._id}/invoices`, { description: 'Bad amount', amountMinor: 0.1, dueDate: '2026-01-01' }).expect(400);
  await call('patch', `/api/owner/schools/${school._id}`, { active: false }).expect(200);
  await call('get', '/api/probe', undefined, principalToken).expect(403);
  await call('patch', `/api/owner/schools/${school._id}`, { active: true }).expect(200);
  await call('patch', `/api/owner/schools/${school._id}/branches/${branchA._id}`, { active: false }).expect(200);
  await call('get', '/api/probe', undefined, principalToken).expect(403);
  await call('patch', `/api/owner/schools/${school._id}/branches/${branchA._id}`, { active: true }).expect(200);
  assert.equal(require('../src/routes/ownerRoutes').dueAt('2026-09-13').toISOString(), '2026-09-13T18:29:59.999Z');
});
test('shared login returns an owner session for Flutter and restricts owner billing data', async () => {
  const shared = await call('post', '/api/auth/login', { email: 'owner@example.com', password, schoolCode: 'not-a-school' }, null).expect(200);
  assert.equal(shared.body.user.role, 'owner');
  await call('post', '/api/auth/login', { email: 'owner@example.com', password: 'incorrect' }, null).expect(401);
  await call('get', '/api/owner/schools', undefined, shared.body.token).expect(200);
  const bills = await call('get', '/api/owner/invoices', undefined, shared.body.token).expect(200);
  assert.equal(bills.body.length, 1);
  assert.equal(bills.body[0].schoolId.name, 'Oak School');
  assert.equal(bills.body[0].status, 'paid');
  assert.ok(!JSON.stringify(bills.body).includes('encryptedUri'));
  await call('get', '/api/owner/invoices', undefined, principalToken).expect(403);
  await call('get', '/api/probe', undefined, shared.body.token).expect(403);
});
test('owner lists school users across branches and edits accounts without changing permissions', async () => {
  const base = `/api/owner/schools/${school._id}`;
  const listed = (await call('get', `${base}/users`).expect(200)).body;
  assert.ok(listed.items.some(item => item.role === 'principal' && item.branchId === null));
  assert.ok(listed.items.some(item => item.role === 'teacher' && item.branchId === String(branchA._id)));
  assert.ok(listed.items.some(item => item.role === 'teacher' && item.branchId === String(branchB._id)));
  assert.ok(!JSON.stringify(listed).includes('passwordHash'));
  assert.ok(!JSON.stringify(listed).includes('encryptedUri'));
  await call('get', `${base}/users`, undefined, principalToken).expect(403);
  const filtered = (await call('get', `${base}/users?role=teacher&branchId=${branchB._id}&limit=1`).expect(res => assert.equal(res.status, 200, JSON.stringify(res.body)))).body;
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].branchId, String(branchB._id));
  assert.equal((await call('get', `${base}/users?search=${encodeURIComponent('teacher@test.com')}`).expect(200)).body.total, 2);
  assert.equal((await call('get', `${base}/users?search=${encodeURIComponent('teacher@testXcom')}`).expect(200)).body.total, 0);
  const teacherId = filtered.items[0].id;
  const path = `${base}/branches/${branchB._id}/users/${teacherId}`;
  const south = await platform.get().Branch.findById(branchB._id).select('+encryptedUri');
  await runBranch(school, south, () => Teacher.create({
    name: 'South Teacher', firstName: 'South', phone: '1234567891',
    email: 'teacher@test.com', subject: 'Math', userId: teacherId,
  }));
  await call('patch', path, { role: 'principal' }).expect(400);
  await call('patch', path, { email: 'principal@oak.test' }).expect(409);
  const changed = (await call('patch', path, { name: 'Updated Teacher', email: 'updated-teacher@oak.test', phone: '9896543210', active: false }).expect(200)).body;
  assert.equal(changed.name, 'Updated Teacher');
  assert.equal(changed.active, false);
  await runBranch(school, south, async () => {
    const user = await User.findById(teacherId);
    assert.equal(user.role, 'teacher');
    assert.equal(user.email, 'updated-teacher@oak.test');
    assert.equal(user.phone, '9896543210');
    const profile = await Teacher.findOne({ userId: teacherId });
    assert.equal(profile.name, 'Updated Teacher');
    assert.equal(profile.email, 'updated-teacher@oak.test');
    assert.equal(profile.phone, '9896543210');
    assert.equal(profile.status, 'inactive');
  });
  await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'south', email: 'updated-teacher@oak.test', password }, null).expect(403);
  await call('patch', path, { active: true }).expect(200);
  await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'south', email: 'updated-teacher@oak.test', password }, null).expect(200);
  const principal = listed.items.find(item => item.role === 'principal');
  await call('patch', `${base}/principals/${principal.id}`, { role: 'owner' }).expect(400);
  await call('patch', `${base}/principals/${principal.id}`, { name: 'Updated Principal', email: 'new-principal@oak.test', phone: '9765432100' }).expect(200);
  await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'north', email: 'principal@oak.test', password }, null).expect(401);
  await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'north', email: '9876543210', password }, null).expect(401);
  await call('post', '/api/auth/login', { schoolCode: 'oak', email: '9765432100', password }, null).expect(200);
  await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'north', email: 'new-principal@oak.test', password }, null).expect(200);
  await call('patch', `${base}/principals/${principal.id}`, { phone: '9654321000' }).expect(200);
  await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'north', email: '9765432100', password }, null).expect(401);
  await call('post', '/api/auth/login', { schoolCode: 'oak', email: '9654321000', password }, null).expect(200);
  await call('patch', `${base}/principals/${principal.id}`, { active: false }).expect(200);
  await call('post', '/api/auth/login', { schoolCode: 'oak', branchCode: 'north', email: 'new-principal@oak.test', password }, null).expect(401);
});
test('owner password change revokes previously issued owner tokens', async () => {
  await call('put', '/api/owner/password', { currentPassword: password, newPassword: 'Changed-Owner-Password1' }).expect(200);
  await call('get', '/api/owner/schools').expect(403);
  await call('post', '/api/owner/login', { email: 'owner@example.com', password }, null).expect(401);
});
