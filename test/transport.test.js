const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Student = require('../src/models/Student');
require('../src/models/SchoolClass');
const { Driver, Trip } = require('../src/models/Transport');
let mongo, app, admin, parent, driver, vehicle, children, pickup, mediaRoot;
const auth = user => ({ Authorization: `Bearer ${jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET)}` });
const gps = () => ({ latitude: 28.61, longitude: 77.21, accuracy: 8, capturedAt: new Date().toISOString() });
const post = (url, user, body) => request(app).post(`/transport${url}`).set(auth(user)).send(body);
before(async () => {
  process.env.JWT_SECRET = 'transport-integration-test-only';
  mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'transport-media-test-'));
  process.env.MEDIA_STORAGE_ROOT = mediaRoot;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('transport'));
  app = express(); app.use(express.json());
  const schoolId = new mongoose.Types.ObjectId(), branchId = new mongoose.Types.ObjectId();
  app.use((req, res, next) => { req.tenant = { school: { _id: schoolId }, branch: { _id: branchId } }; next(); });
  app.use('/transport', require('../src/routes/transportRoutes'));
  app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
  const classId = new mongoose.Types.ObjectId();
  children = await Student.create([{ name: 'One', admissionNo: '1', classId }, { name: 'Two', admissionNo: '2', classId }]);
  admin = await User.create({ name: 'Principal', email: 'principal@test.local', passwordHash: 'unused', role: 'principal' });
  parent = await User.create({ name: 'Parent', email: 'parent@test.local', passwordHash: 'unused', role: 'parent', childStudentIds: [children[0]._id] });
});
after(async () => {
  await mongoose.disconnect(); await mongo?.stop();
  assert.equal(path.dirname(path.resolve(mediaRoot)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(mediaRoot).startsWith('transport-media-test-'));
  await fs.rm(mediaRoot, { recursive: true, force: true });
});
test('setup creates login credentials, enforces roles and capacity', async () => {
  await post('/drivers', parent, {}).expect(403);
  await post('/drivers', admin, { name: 'Driver', phone: '9990001234', password: 'Initial-password-123', licenceNumber: 'DL-123' }).expect(400);
  const d = (await post('/drivers', admin, { name: 'Driver', phone: '9990001234', email: 'driver@test.local', password: 'Initial-password-123', licenceNumber: 'DL-123' }).expect(201)).body;
  driver = await User.findById(d.userId);
  assert.equal(driver.role, 'driver');
  assert.equal(driver.email, 'driver@test.local');
  vehicle = (await post('/vehicles', admin, { registration: 'DL 01 AB 123', type: 'Bus', capacity: 2, driverId: d._id }).expect(201)).body;
  const rows = children.map(c => ({ studentId: String(c._id), pickup: true, dropoff: true }));
  await request(app).put(`/transport/vehicles/${vehicle._id}/students`).set(auth(admin)).send({ students: rows }).expect(200);
  await post('/driver/trips', driver, { vehicleId: vehicle._id, kind: 'pickup', location: gps() }).expect(403);
  await request(app).put('/transport/driver/password').set(auth(driver)).send({ currentPassword: 'Initial-password-123', newPassword: 'New-driver-password-123' }).expect(200);
  assert.equal((await Driver.findById(d._id)).mustChangePassword, false);
  await request(app).patch(`/transport/vehicles/${vehicle._id}`).set(auth(admin)).send({ registration: vehicle.registration, type: 'Bus', capacity: 1, driverId: d._id }).expect(400);
});
test('parent ownership, pre-trip cancellation and parent data isolation', async () => {
  await post('/parent/cancel', parent, { childId: children[1]._id }).expect(403);
  await post('/parent/cancel', parent, { childId: children[0]._id, reason: 'Not attending' }).expect(200);
  pickup = (await post('/driver/trips', driver, { vehicleId: vehicle._id, kind: 'pickup', location: gps() }).expect(201)).body;
  assert.equal(pickup.students[0].status, 'cancelled');
  const state = (await request(app).get('/transport/parent/state').query({ childId: String(children[0]._id) }).set(auth(parent)).expect(200)).body;
  assert.equal(state.trips[0].students, undefined);
  assert.equal(state.trips[0].student.name, 'One');
  await post(`/driver/trips/${pickup._id}/events`, driver, { studentId: children[0]._id, eventId: 'cancelled-pick', action: 'picked', location: gps() }).expect(409);
  await post(`/driver/trips/${pickup._id}/complete`, driver, {}).expect(409);
});
test('pickup GPS, idempotent events, onboard safety and completed tracking', async () => {
  const body = { studentId: children[1]._id, eventId: 'pick-two', action: 'picked', at: new Date().toISOString(), location: gps() };
  await post(`/driver/trips/${pickup._id}/events`, driver, { ...body, location: { ...gps(), latitude: 200 } }).expect(400);
  await post(`/driver/trips/${pickup._id}/events`, driver, body).expect(200);
  await post(`/driver/trips/${pickup._id}/events`, driver, body).expect(200);
  assert.equal((await Trip.findById(pickup._id)).events.length, 1);
  await post(`/driver/trips/${pickup._id}/complete`, driver, {}).expect(409);
  await post(`/driver/trips/${pickup._id}/events`, driver, { studentId: children[1]._id, eventId: 'arrive-two', action: 'arrived' }).expect(200);
  await post(`/driver/trips/${pickup._id}/complete`, driver, {}).expect(200);
  await post(`/driver/trips/${pickup._id}/location`, driver, gps()).expect(409);
});
test('pickup cancellation does not cancel drop-off and handover remains onboard', async () => {
  const trip = (await post('/driver/trips', driver, { vehicleId: vehicle._id, kind: 'dropoff', location: gps() }).expect(201)).body;
  assert.ok(trip.students.every(s => s.status === 'awaiting'));
  await post(`/driver/trips/${trip._id}/events`, driver, { studentId: children[0]._id, eventId: 'board', action: 'boarded' }).expect(200);
  await post(`/driver/trips/${trip._id}/events`, driver, { studentId: children[0]._id, eventId: 'handover', action: 'handover_issue', note: 'Guardian unavailable' }).expect(200);
  assert.equal((await Trip.findById(trip._id)).students[0].status, 'boarded');
  await post(`/driver/trips/${trip._id}/complete`, driver, {}).expect(409);
});
test('concurrent cancellation and pickup cannot both succeed; other drivers cannot mutate trips', async () => {
  const user = await User.create({ name: 'Other driver', email: 'other-driver@test.local', passwordHash: 'unused', role: 'driver' });
  const d = await Driver.create({ userId: user._id, name: user.name, phone: '9990009999', licenceNumber: 'DL2', mustChangePassword: false });
  await post(`/driver/trips/${pickup._id}/events`, user, { studentId: children[1]._id, eventId: 'unauthorized', action: 'picked' }).expect(404);
  const bus = (await post('/vehicles', admin, { registration: 'SECOND', capacity: 2, type: 'Van', driverId: d._id }).expect(201)).body;
  const child = await Student.create({ name: 'Race', admissionNo: 'race', classId: new mongoose.Types.ObjectId() });
  const guardian = await User.create({ name: 'Guardian', email: 'guardian@test.local', passwordHash: 'unused', role: 'parent', childStudentIds: [child._id] });
  await request(app).put(`/transport/vehicles/${bus._id}/students`).set(auth(admin)).send({ students: [{ studentId: String(child._id), pickup: true, dropoff: true }] }).expect(200);
  const trip = (await post('/driver/trips', user, { vehicleId: bus._id, kind: 'pickup', location: gps() }).expect(201)).body;
  const results = await Promise.all([
    post('/parent/cancel', guardian, { childId: child._id }),
    post(`/driver/trips/${trip._id}/events`, user, { studentId: child._id, eventId: 'race-pickup', action: 'picked', location: gps() }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const saved = await Trip.findById(trip._id);
  assert.ok(['picked', 'cancelled'].includes(saved.students[0].status));
});
test('licence images are private and reject arbitrary file types', async () => {
  await request(app).post('/transport/documents').set(auth(parent)).attach('document', Buffer.from('bad'), 'bad.png').expect(403);
  await request(app).post('/transport/documents').set(auth(admin)).attach('document', Buffer.from('<script>bad</script>'), 'bad.png').expect(400);
  const result = await request(app).post('/transport/documents').set(auth(admin))
    .attach('document', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=', 'base64'), 'licence.png').expect(201);
  await request(app).get(`/transport/documents/${result.body.id}`).set(auth(parent)).expect(403);
  await request(app).get(`/transport/documents/${result.body.id}`).set(auth(admin)).expect(200);
});
test('today\'s cancellation follows a child reassigned before the trip starts', async () => {
  const user = await User.create({ name: 'Replacement driver', email: 'replacement@test.local', passwordHash: 'unused', role: 'driver' });
  const d = await Driver.create({ userId: user._id, name: user.name, phone: '9990008888', licenceNumber: 'DL3', mustChangePassword: false });
  const first = (await post('/vehicles', admin, { registration: 'ORIGINAL', capacity: 1, type: 'Van' }).expect(201)).body;
  const replacement = (await post('/vehicles', admin, { registration: 'REPLACEMENT', capacity: 1, type: 'Van', driverId: d._id }).expect(201)).body;
  const child = await Student.create({ name: 'Reassigned', admissionNo: 'reassigned', classId: new mongoose.Types.ObjectId() });
  const guardian = await User.create({ name: 'Guardian2', email: 'guardian2@test.local', passwordHash: 'unused', role: 'parent', childStudentIds: [child._id] });
  const rows = [{ studentId: String(child._id), pickup: true, dropoff: true }];
  await request(app).put(`/transport/vehicles/${first._id}/students`).set(auth(admin)).send({ students: rows }).expect(200);
  await post('/parent/cancel', guardian, { childId: child._id }).expect(200);
  await request(app).put(`/transport/vehicles/${first._id}/students`).set(auth(admin)).send({ students: [] }).expect(200);
  await request(app).put(`/transport/vehicles/${replacement._id}/students`).set(auth(admin)).send({ students: rows }).expect(200);
  const trip = (await post('/driver/trips', user, { vehicleId: replacement._id, kind: 'pickup', location: gps() }).expect(201)).body;
  assert.equal(trip.students[0].status, 'cancelled');
});
