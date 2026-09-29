const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Staff = require('../src/models/Staff');
const User = require('../src/models/User');
const Student = require('../src/models/Student');
const SchoolClass = require('../src/models/SchoolClass');
const FeeStructure = require('../src/models/FeeStructure');
const StaffDepartment = require('../src/models/StaffDepartment');
let mongo, app, staff, staffUser, principal, pupil, klass;
const headers = user => ({ Authorization: `Bearer ${jwt.sign({ id: String(user._id), role: user.role, permissions: ['fees', 'students', 'classes', 'reports'] }, process.env.JWT_SECRET)}` });
const get = (url, user = staffUser) => request(app).get(url).set(headers(user));
before(async () => {
  process.env.JWT_SECRET = 'staff-permission-test-only';
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('staff-access'));
  app = express(); app.use(express.json());
  app.use('/api/auth', require('../src/routes/authRoutes'));
  for (const [path, file] of [['fees', 'feesRoutes'], ['classes', 'classRoutes'], ['students', 'studentRoutes'],
    ['salary', 'salaryRoutes'], ['staff', 'staffRoutes'], ['dashboard', 'dashboardRoutes'], ['parents', 'parentRoutes'], ['section-transfers', 'sectionTransferRoutes']]) {
    app.use(`/api/${path}`, require(`../src/routes/${file}`));
  }
  app.use((e, req, res, next) => res.status(e.status || (e.name === 'ValidationError' ? 400 : 500)).json({ message: e.message }));
  principal = await User.create({ name: 'Principal', email: 'principal@access.test', role: 'principal', passwordHash: 'unused' });
  staffUser = await User.create({ name: 'Cashier', email: 'cashier@access.test', phone: '9990001234', role: 'staff', passwordHash: await bcrypt.hash('staff-login-test', 4) });
  staff = await Staff.create({ name: 'Cashier', firstName: 'Cashier', phone: '9990001234', department: 'Finance', userId: staffUser._id, permissions: ['fees'] });
  klass = await SchoolClass.create({ name: '1st-A', grade: '1st', section: 'A', gradeBand: 'Primary' });
  pupil = await Student.create({ name: 'Yash', admissionNo: 'Y1', classId: klass._id, fatherPhone: '9990001111', disabilityType: 'Private medical data', hasDisability: true });
  await FeeStructure.create({ sessionStartMonth: 4, gradeFees: [{ grade: '1st', monthlyFee: 100 }] });
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test('staff can log in with email or saved phone number using the same password', async () => {
  for (const email of ['cashier@access.test', ' CASHIER@ACCESS.TEST ', ' 9990001234 ']) {
    const response = await request(app).post('/api/auth/login').send({ email, password: 'staff-login-test' }).expect(200);
    assert.equal(response.body.user.id, String(staffUser._id));
    assert.deepEqual(response.body.user.permissions, ['fees']);
    assert.equal(jwt.verify(response.body.token, process.env.JWT_SECRET).role, 'staff');
  }
  for (const email of ['cashier@access.test', '9990001234']) {
    await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' }).expect(401);
  }
  await request(app).post('/api/auth/login').send({ email: '9990001234', password: '' }).expect(400);
});
test('annual charges staff gets scoped class/student lookups without student-management access', async () => {
  const classes = (await get('/api/fees/classes').expect(200)).body.classes;
  assert.equal(classes[0].name, '1st-A');
  const students = (await get('/api/fees/students?search=yash&limit=12').expect(200)).body.students;
  assert.equal(students[0].id, String(pupil._id));
  assert.equal(students[0].class.id, String(klass._id));
  assert.equal(students[0].disabilityType, undefined);
  assert.equal(students[0].dateOfBirth, undefined);
  assert.equal(students[0].parentDashboardPhone, undefined);
  for (const url of ['/api/classes', '/api/students', '/api/students/summary', '/api/students/disability-options', '/api/students/reservation-options', '/api/staff', '/api/dashboard/reports', '/api/dashboard/billing', '/api/section-transfers']) await get(url).expect(403);
  await request(app).post('/api/classes').set(headers(staffUser)).send({ grade: '2nd', section: 'A' }).expect(403);
  await request(app).post('/api/parents').set(headers(staffUser)).send({}).expect(403);
});
test('fees-only staff can record a payment and receive the successful receipt', async () => {
  await get(`/api/fees/monthly-status?studentId=${pupil._id}`).expect(200);
  const response = await request(app).post('/api/fees/payment').set(headers(staffUser))
    .send({ studentId: String(pupil._id), monthsCount: 1, chargeIds: [], discountMode: 'amount', discountValue: 0, paymentMode: 'cash' }).expect(201);
  assert.equal(response.body.amount, 100);
  await get(`/api/fees/transactions?studentId=${pupil._id}`).expect(200);
});
test('dashboard does not leak unassigned sections and returns current permissions', async () => {
  const dashboard = (await get('/api/dashboard/principal').expect(200)).body;
  assert.deepEqual(dashboard.permissions, ['fees']);
  assert.equal(dashboard.stats.totalStudents.value, 0);
  assert.deepEqual(dashboard.topStudents, []);
  assert.equal(dashboard.feesCollection.collected, 100);
});
test('permissions are checked in DB rather than JWT and revoked access takes effect immediately', async () => {
  await Staff.updateOne({ _id: staff._id }, { permissions: ['students'] });
  const denied = await get('/api/fees/classes');
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  await get('/api/fees/students').expect(403);
  await get('/api/salary/report').expect(403);
  const restored = await get('/api/students');
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  await get('/api/students/classes').expect(200);
  await get('/api/classes').expect(403);
  await Staff.updateOne({ _id: staff._id }, { status: 'inactive' });
  await get('/api/students').expect(403);
  await get('/api/dashboard/principal').expect(403);
});
test('departments can be added before saving staff and deduplicate case-insensitively', async () => {
  await request(app).post('/api/staff/departments').set(headers(staffUser)).send({ name: 'HR' }).expect(403);
  for (const name of ['Administration', 'administration']) await request(app).post('/api/staff/departments').set(headers(principal)).send({ name }).expect(201);
  assert.equal(await StaffDepartment.countDocuments(), 1);
  const departments = (await get('/api/staff/departments', principal).expect(200)).body.departments;
  assert.ok(departments.includes('Administration')); assert.ok(departments.includes('Finance'));
});
test('staff dates and enum gender save correctly; invalid values do not create orphan logins', async () => {
  const body = { firstName: 'New staff', department: 'Administration', email: 'new@access.test', phone: '9991234567', password: 'test-password', permissions: ['fees'], dateOfBirth: '1995-04-12', dateOfJoining: '2026-09-01', weddingDate: '2020-01-15', gender: 'female' };
  await request(app).post('/api/staff').set(headers(principal)).send({ ...body, gender: 'invalid' }).expect(400);
  assert.equal(await User.countDocuments({ email: body.email }), 0);
  const saved = (await request(app).post('/api/staff').set(headers(principal)).send(body).expect(201)).body;
  assert.equal(saved.gender, 'female'); assert.match(saved.dateOfBirth, /^1995-04-12/);
  assert.match(saved.dateOfJoining, /^2026-09-01/); assert.equal(saved.department, 'Administration');
});
