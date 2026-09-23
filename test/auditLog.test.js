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
const { gate, runBranch } = require('../src/tenancy/access');
const AuditLog = require('../src/models/AuditLog');
const { redactSecrets } = require('../src/utils/auditLog');

let mongo, app, ownerToken, school, branchA, branchB, principalToken;
const password = 'Test-Password-123!';

const call = (method, path, body, token = ownerToken) => {
  const req = request(app)[method](path);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};

before(async () => {
  process.env.JWT_SECRET = 'test-audit-secret-key';
  process.env.TENANT_DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.OWNER_DB_NAME = 'schoolo_audit_test_platform';
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri('legacy_data');
  await mongoose.connect(process.env.MONGODB_URI);
  await require('../src/tenancy/initialize')();

  await platform.get().Owner.create({
    email: 'owner@example.com',
    name: 'Master Owner',
    passwordHash: await bcrypt.hash(password, 4),
  });

  app = express();
  app.use(express.json());
  app.use('/api/owner', require('../src/routes/ownerRoutes'));
  app.post('/api/auth/login', require('../src/routes/ownerRoutes').sharedLogin);
  app.use('/api', gate);
  app.use('/api/auth', require('../src/routes/authRoutes'));
  app.use('/api/classes', require('../src/routes/classRoutes'));
  app.use('/api/audit', require('../src/routes/auditRoutes'));
  app.use((error, req, res, next) =>
    res.status(error.status || (error.code === 11000 ? 409 : 500)).json({ message: error.message })
  );

  ownerToken = (await call('post', '/api/owner/login', { email: 'owner@example.com', password }, null).expect(200)).body.token;

  // Create school with Oak North and Oak South
  const payload = {
    name: 'Oakridge School',
    code: 'oakridge',
    branchName: 'Main Campus',
    branchCode: 'main',
    mongoUri: mongo.getUri('oakridge_main'),
    principalName: 'Dr. Principal',
    principalEmail: 'principal@oakridge.test',
    principalPassword: password,
  };
  school = (await call('post', '/api/owner/schools', payload).expect(201)).body;

  branchA = await platform.get().Branch.findOne({ schoolId: school._id, code: 'main' }).select('+encryptedUri');
  branchB = (await call('post', `/api/owner/schools/${school._id}/branches`, {
    name: 'West Campus',
    code: 'west',
    mongoUri: mongo.getUri('oakridge_west'),
  }).expect(201)).body;

  // Log in as Oakridge Principal
  const loginRes = await call('post', '/api/auth/login', {
    schoolCode: 'oakridge',
    email: 'principal@oakridge.test',
    password,
  }, null).expect(200);
  principalToken = loginRes.body.token;
});

after(async () => {
  await databases.close();
  await platform.close();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test('redactSecrets cleanly removes password and tokens from objects and nested structures', () => {
  const input = {
    name: 'Alice',
    password: 'superSecretPassword',
    details: {
      email: 'alice@test.com',
      token: 'jwt.token.here',
      profile: {
        currentPassword: 'old',
        valid: true,
      },
    },
  };
  const cleaned = redactSecrets(input);
  assert.equal(cleaned.name, 'Alice');
  assert.equal(cleaned.password, undefined);
  assert.equal(cleaned.details.email, 'alice@test.com');
  assert.equal(cleaned.details.token, undefined);
  assert.equal(cleaned.details.profile.currentPassword, undefined);
  assert.equal(cleaned.details.profile.valid, true);
});

test('creating a class via API writes an audit log in the branch database', async () => {
  const res = await call('post', '/api/classes', {
    grade: '10',
    section: 'A',
    roomNo: '101',
  }, principalToken).expect(201);

  assert.equal(res.body.name, '10-A');

  // Verify AuditLog in branch database via runBranch
  const logs = await runBranch(school, branchA, async () => {
    return AuditLog.find({ entityType: 'Class', action: 'create' }).lean();
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].performedBy.role, 'principal');
  assert.equal(logs[0].performedBy.name, 'Dr. Principal');
  assert.equal(logs[0].performedBy.email, 'principal@oakridge.test');
  assert.equal(logs[0].branchName, 'Main Campus');
  assert.ok(logs[0].note.includes('Created class 10-A'));
});

test('Principal can retrieve paginated audit logs with search and filters', async () => {
  // Call GET /api/audit
  const res = await call('get', '/api/audit?page=1&limit=10', undefined, principalToken).expect(200);

  assert.ok(Array.isArray(res.body.items));
  assert.ok(res.body.total >= 1);
  assert.equal(res.body.page, 1);
  assert.ok(res.body.items.some(l => l.entityType === 'Class' && l.action === 'create'));

  // Filter by entityType
  const classRes = await call('get', '/api/audit?entityType=Class', undefined, principalToken).expect(200);
  assert.ok(classRes.body.items.every(l => l.entityType === 'Class'));

  // Search by text
  const searchRes = await call('get', '/api/audit?search=10-A', undefined, principalToken).expect(200);
  assert.ok(searchRes.body.items.length >= 1);
  assert.ok(searchRes.body.items[0].note.includes('10-A'));
});

test('Owner Admin can retrieve audit logs of each school across its branches', async () => {
  // Call GET /api/owner/schools/:id/logs
  const res = await call('get', `/api/owner/schools/${school._id}/logs`, undefined, ownerToken).expect(200);

  assert.equal(res.body.school.code, 'oakridge');
  assert.ok(Array.isArray(res.body.items));
  assert.ok(res.body.total >= 1);
  assert.ok(res.body.items.some(l => l.note.includes('Created class 10-A')));
  assert.equal(res.body.items[0].branchName, 'Main Campus');
  assert.equal(res.body.items[0].branchCode, 'main');
});
