const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { Driver, Vehicle, Assignment, Cancellation, Trip, Position } = require('../models/Transport');
const Student = require('../models/Student');
const User = require('../models/User');
const { connection } = require('../tenancy/context');
const { logAction } = require('../utils/auditLog');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const id = value => { if (!mongoose.isValidObjectId(value)) fail(400, 'Invalid identifier'); return String(value); };
const text = (value, label, required = true, max = 200) => {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `${label} is invalid`);
  return value.trim();
};
const date = value => { if (!value) return undefined; const d = new Date(value); if (isNaN(d)) fail(400, 'Invalid date'); return d; };
const activeTrip = async (vehicleId, session) => Trip.exists({ vehicleId, status: 'active' }).session(session || null);
async function atomic(work) {
  await Promise.all([Vehicle.init(), Driver.init(), Assignment.init(), Cancellation.init(), Trip.init()]);
  const session = await connection().startSession();
  let value;
  try { await session.withTransaction(async () => { value = await work(session); }); }
  catch (error) {
    if (error.code === 11000 || error.code === 112) fail(409, 'This assignment, account or trip already exists or changed. Refresh and try again.');
    throw error;
  } finally { await session.endSession(); }
  return value;
}
async function lockVehicle(vehicleId, session) {
  const vehicle = await Vehicle.findByIdAndUpdate(id(vehicleId), { $inc: { revision: 1 } }, { new: true, session });
  if (!vehicle) fail(404, 'Vehicle not found');
  return vehicle;
}
async function driverFor(req, session, allowPassword = false) {
  const driver = await Driver.findOne({ userId: req.user.id, active: true }).session(session || null);
  if (!driver) fail(403, 'Driver account unavailable');
  if (!allowPassword && driver.mustChangePassword) fail(403, 'Change your initial password before starting a trip');
  return driver;
}
async function childFor(req) {
  const childId = id(req.query.childId || req.body.childId);
  const user = await User.findById(req.user.id).select('childStudentIds');
  if (!user?.childStudentIds.some(c => String(c) === childId)) fail(403, 'This child is not linked to your account');
  return childId;
}
function gps(input, at = new Date(), optional = false) {
  if (!input && optional) return undefined;
  if (!input || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) ||
      Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180 ||
      !Number.isFinite(input.accuracy) || input.accuracy < 0 || input.accuracy > 100) fail(400, 'A GPS fix accurate to 100 metres is required');
  const capturedAt = new Date(input.capturedAt);
  if (isNaN(capturedAt) || Math.abs(at - capturedAt) > 120000) fail(400, 'Location is stale. Get a fresh GPS position');
  return { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy, capturedAt };
}
async function adminData(req, res) {
  const [vehicles, drivers, assignments, trips, students] = await Promise.all([
    Vehicle.find().sort({ registration: 1 }).lean(), Driver.find().sort({ name: 1 }).lean(),
    Assignment.find().lean(), Trip.find({ $or: [{ date: today() }, { status: 'active' }] }).sort({ startedAt: -1 }).lean(),
    Student.find({ status: { $ne: 'inactive' } }).select('name admissionNo classId').populate('classId', 'name').lean(),
  ]);
  res.json({ vehicles, drivers, assignments, trips, students, date: today() });
}
async function saveDriver(req, res) {
  const b = req.body, name = text(b.name, 'Name'), phone = text(b.phone, 'Phone', true, 20);
  if (b.active != null && typeof b.active !== 'boolean') fail(400, 'Active must be a boolean');
  if (!/^\+?[0-9]{7,15}$/.test(phone)) fail(400, 'Enter a valid mobile number');
  const email = b.email ? text(b.email, 'Email').toLowerCase() : undefined;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Invalid email');
  if ((!req.params.id || b.password) && (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 72)) fail(400, 'Initial password must have 12 to 72 characters');
  const fields = { name, phone, email, address: text(b.address, 'Address', false, 1000),
    emergencyContact: text(b.emergencyContact, 'Emergency contact', false),
    licenceNumber: text(b.licenceNumber, 'Licence number'), licenceExpiry: date(b.licenceExpiry),
    licenceDocument: text(b.licenceDocument, 'Licence document', false, 1000), photo: text(b.photo, 'Photo', false, 1000) };
  const passwordHash = b.password ? await bcrypt.hash(b.password, 12) : undefined;
  const driver = await atomic(async session => {
    let driver = req.params.id ? await Driver.findById(id(req.params.id)).session(session) : null;
    if (req.params.id && !driver) fail(404, 'Driver not found');
    if (driver && await Trip.exists({ driverId: driver._id, status: 'active' }).session(session)) fail(409, 'Complete the driver\'s active trip first');
    const conflict = await User.exists({ _id: { $ne: driver?.userId }, $or: [{ phone }, ...(email ? [{ email }] : [])] }).session(session);
    if (conflict) fail(409, 'Phone or email is already used by another account');
    const userId = driver?.userId || new mongoose.Types.ObjectId();
    const active = b.active !== false;
    if (driver) {
      await User.updateOne({ _id: userId }, { $set: { name, phone, active, ...(email ? { email } : {}), ...(passwordHash ? { passwordHash } : {}) } }, { session });
      Object.assign(driver, fields, { active }, passwordHash ? { mustChangePassword: true } : {});
      await driver.save({ session });
    } else {
      await User.create([{ _id: userId, name, phone, email: email || `driver-${userId}@school.internal`, passwordHash, role: 'driver', active }], { session });
      [driver] = await Driver.create([{ ...fields, userId, active }], { session });
    }
    return driver;
  });
  await require('../services/mediaStorage').attach(req, 'transport', driver);
  await logAction({ req, entityType: 'TransportDriver', entityId: driver._id, action: req.params.id ? 'update' : 'create', detail: { name, phone } });
  res.status(req.params.id ? 200 : 201).json(driver);
}
async function saveVehicle(req, res) {
  const b = req.body;
  if (b.active != null && typeof b.active !== 'boolean') fail(400, 'Active must be a boolean');
  const registration = text(b.registration, 'Registration').toUpperCase().replace(/\s/g, '');
  if (!Number.isInteger(b.capacity) || b.capacity < 1 || b.capacity > 100) fail(400, 'Capacity must be 1 to 100');
  const fields = { registration, capacity: b.capacity, type: text(b.type, 'Vehicle type'),
    driverId: b.driverId ? id(b.driverId) : null, active: b.active !== false,
    insuranceExpiry: date(b.insuranceExpiry), fitnessExpiry: date(b.fitnessExpiry), photo: text(b.photo, 'Photo', false, 1000) };
  const vehicle = await atomic(async session => {
    if (fields.driverId && !await Driver.exists({ _id: fields.driverId, active: true }).session(session)) fail(400, 'Select an active driver');
    if (req.params.id) {
      const current = await lockVehicle(req.params.id, session);
      if (await activeTrip(current._id, session)) fail(409, 'Complete the active trip before editing the vehicle');
      const students = await Assignment.countDocuments({ vehicleId: current._id }).session(session);
      if (students > fields.capacity) fail(400, 'Capacity is below the number of assigned students');
      Object.assign(current, fields); await current.save({ session }); return current;
    }
    return (await Vehicle.create([fields], { session }))[0];
  });
  await logAction({ req, entityType: 'TransportVehicle', entityId: vehicle._id, action: req.params.id ? 'update' : 'create' });
  res.status(req.params.id ? 200 : 201).json(vehicle);
}
async function assign(req, res) {
  const rows = req.body.students;
  if (!Array.isArray(rows) || rows.length > 100 || new Set(rows.map(r => r?.studentId)).size !== rows.length) fail(400, 'Invalid student selection');
  for (const r of rows) {
    id(r.studentId);
    if (typeof r.pickup !== 'boolean' || typeof r.dropoff !== 'boolean' || (!r.pickup && !r.dropoff)) fail(400, 'Select pickup or drop-off for every student');
    r.instructions = text(r.instructions, 'Instructions', false, 500);
  }
  await atomic(async session => {
    const vehicle = await lockVehicle(req.params.id, session);
    if (!vehicle.active) fail(400, 'Vehicle is disabled');
    if (await activeTrip(vehicle._id, session)) fail(409, 'Complete the active trip before changing assignments');
    if (rows.length > vehicle.capacity) fail(400, 'Vehicle capacity exceeded');
    const ids = rows.map(r => r.studentId);
    if (await Student.countDocuments({ _id: { $in: ids }, status: { $ne: 'inactive' } }).session(session) !== rows.length) fail(400, 'Select valid active students');
    if (await Assignment.exists({ studentId: { $in: ids }, vehicleId: { $ne: vehicle._id } }).session(session)) fail(409, 'A student is assigned to another vehicle. Remove that assignment first');
    await Assignment.deleteMany({ vehicleId: vehicle._id }, { session });
    if (rows.length) await Assignment.create(rows.map(r => ({ studentId: r.studentId, vehicleId: vehicle._id,
      pickup: r.pickup, dropoff: r.dropoff, instructions: r.instructions })), { session, ordered: true });
  });
  await logAction({ req, entityType: 'TransportVehicle', entityId: req.params.id, action: 'update', detail: { students: rows } });
  res.json({ message: 'Assignments saved' });
}
async function driverHome(req, res) {
  const driver = await driverFor(req, null, true);
  const vehicles = await Vehicle.find({ driverId: driver._id, active: true });
  const trips = await Trip.find({ driverId: driver._id, $or: [{ date: today() }, { status: 'active' }] }).sort({ startedAt: -1 });
  const assignments = await Assignment.find({ vehicleId: { $in: vehicles.map(v => v._id) } })
    .populate('studentId', 'name admissionNo').lean();
  const cancellations = await Cancellation.find({ studentId: { $in: assignments.filter(a => a.studentId).map(a => a.studentId._id) }, date: today() }).lean();
  res.json({ driver, vehicles, trips, assignments, cancellations, date: today() });
}
async function password(req, res) {
  const user = await User.findById(req.user.id);
  if (typeof req.body.currentPassword !== 'string' || !await bcrypt.compare(req.body.currentPassword, user.passwordHash)) fail(400, 'Current password is incorrect');
  const value = req.body.newPassword;
  if (typeof value !== 'string' || value.length < 12 || value.length > 72) fail(400, 'Use 12 to 72 characters');
  const hash = await bcrypt.hash(value, 12);
  await atomic(async session => {
    await User.updateOne({ _id: user._id }, { passwordHash: hash }, { session });
    await Driver.updateOne({ userId: user._id }, { mustChangePassword: false }, { session });
  });
  res.json({ message: 'Password changed' });
}
async function start(req, res) {
  const { vehicleId, kind } = req.body;
  if (!['pickup', 'dropoff'].includes(kind)) fail(400, 'Choose pickup or drop-off');
  const initialLocation = gps(req.body.location);
  const trip = await atomic(async session => {
    const driver = await driverFor(req, session);
    if (driver.licenceExpiry && driver.licenceExpiry < new Date(today())) fail(400, 'Driving licence has expired');
    const vehicle = await lockVehicle(vehicleId, session);
    if (!vehicle.active || String(vehicle.driverId) !== String(driver._id)) fail(403, 'Vehicle is not assigned to you');
    const existing = await Trip.findOne({ vehicleId, date: today(), kind }).session(session);
    if (existing && String(existing.driverId) === String(driver._id)) return existing;
    const assignments = await Assignment.find({ vehicleId, [kind]: true }).populate({ path: 'studentId', match: { status: 'active' } }).session(session);
    if (!assignments.some(a => a.studentId)) fail(400, 'No active students assigned for this trip');
    const cancelled = kind === 'pickup' ? await Cancellation.find({ studentId: { $in: assignments.filter(a => a.studentId).map(a => a.studentId._id) }, date: today() }).session(session) : [];
    return (await Trip.create([{ vehicleId, driverId: driver._id, registration: vehicle.registration,
      driverName: driver.name, driverPhone: driver.phone, date: today(), kind, startedAt: new Date(), lastLocation: initialLocation,
      students: assignments.filter(a => a.studentId).map(a => ({ studentId: a.studentId._id, name: a.studentId.name,
        admissionNo: a.studentId.admissionNo, address: a.studentId.address || a.studentId.studentAddress?.line1 || '',
        contact: a.studentId.emergencyContactPhone || a.studentId.motherPhone || a.studentId.fatherPhone,
        instructions: a.instructions, status: cancelled.some(c => String(c.studentId) === String(a.studentId._id)) ? 'cancelled' : 'awaiting' })) }], { session }))[0];
  });
  res.status(201).json(trip);
}
async function ownTrip(req, session) {
  const driver = await driverFor(req, session);
  const trip = await Trip.findOne({ _id: id(req.params.id), driverId: driver._id }).session(session || null);
  if (!trip) fail(404, 'Trip not found');
  return trip;
}
async function position(req, res) {
  const trip = await ownTrip(req);
  if (trip.status !== 'active') fail(409, 'Trip has ended');
  const point = gps(req.body);
  const updated = await Trip.updateOne({ _id: trip._id, status: 'active', $or: [
    { 'lastLocation.capturedAt': { $lt: point.capturedAt } }, { lastLocation: null } ] }, { $set: { lastLocation: point } });
  if (updated.modifiedCount) await Position.create({ tripId: trip._id, location: point });
  res.json({ message: 'Location received' });
}
async function event(req, res) {
  const eventId = text(req.body.eventId, 'Event ID', true, 100);
  const action = req.body.action, studentId = id(req.body.studentId);
  const note = text(req.body.note, 'Note', false, 500);
  const at = new Date(req.body.at || Date.now());
  if (isNaN(at) || at > new Date(Date.now() + 60000) || Date.now() - at > 86400000) fail(400, 'Event time must be within the last 24 hours');
  const trip = await atomic(async session => {
    const trip = await ownTrip(req, session);
    await lockVehicle(trip.vehicleId, session);
    const duplicate = trip.events.find(e => e.eventId === eventId);
    if (duplicate) {
      if (String(duplicate.studentId) !== studentId || duplicate.action !== action) fail(409, 'Event ID was already used');
      return trip;
    }
    if (trip.status !== 'active') fail(409, 'Trip has ended');
    if (at < trip.startedAt) fail(400, 'Event predates trip');
    const child = trip.students.find(s => String(s.studentId) === studentId);
    if (!child) fail(404, 'Student not on this trip');
    const allowed = trip.kind === 'pickup'
      ? { awaiting: ['picked', 'absent', 'skipped'], picked: ['arrived'] }
      : { awaiting: ['boarded', 'absent', 'skipped'], boarded: ['dropped', 'handover_issue'] };
    if (!allowed[child.status]?.includes(action)) fail(409, 'Student status changed. Refresh before recording this action');
    if (['absent', 'skipped', 'handover_issue'].includes(action) && !note) fail(400, 'A reason is required');
    let point;
    if (['picked', 'dropped'].includes(action)) {
      if (!req.body.location && note) child.locationException = note;
      else point = gps(req.body.location, at);
    }
    if (action !== 'handover_issue') child.status = action;
    child.note = note;
    if (action === 'picked') { child.pickupLocation = point; child.pickedAt = at; }
    if (action === 'dropped') { child.dropLocation = point; child.droppedAt = at; }
    trip.events.push({ eventId, studentId, action, actorId: req.user.id, at, recordedAt: new Date(), note, location: point });
    if (trip.events.length > 2000) fail(400, 'Trip event limit reached');
    await trip.save({ session }); return trip;
  });
  res.json(trip);
}
async function complete(req, res) {
  const trip = await atomic(async session => {
    const trip = await ownTrip(req, session); await lockVehicle(trip.vehicleId, session);
    if (trip.status === 'completed') return trip;
    if (trip.students.some(s => ['awaiting', 'picked', 'boarded'].includes(s.status))) fail(409, 'Resolve every student and confirm all onboard children arrived or were dropped off');
    trip.status = 'completed'; trip.completedAt = new Date();
    await trip.save({ session }); return trip;
  });
  res.json(trip);
}
async function cancelPickup(req, res) {
  const studentId = await childFor(req);
  const reason = text(req.body.reason, 'Reason', false, 500);
  const result = await atomic(async session => {
    const assignment = await Assignment.findOne({ studentId, pickup: true }).session(session);
    if (!assignment) fail(404, 'No pickup vehicle assigned');
    await lockVehicle(assignment.vehicleId, session);
    const trip = await Trip.findOne({ vehicleId: assignment.vehicleId, date: today(), kind: 'pickup' }).session(session);
    const child = trip?.students.find(s => String(s.studentId) === studentId);
    if (trip && (trip.status !== 'active' || !child || !['awaiting', 'cancelled'].includes(child.status))) fail(409, 'Pickup can no longer be cancelled. Contact the school');
    const cancellation = await Cancellation.findOneAndUpdate({ studentId, date: today() },
      { $setOnInsert: { vehicleId: assignment.vehicleId, parentId: req.user.id, reason } }, { upsert: true, new: true, session });
    if (child && child.status !== 'cancelled') {
      child.status = 'cancelled'; child.note = reason;
      trip.events.push({ eventId: `cancel:${cancellation._id}`, studentId, action: 'cancelled', actorId: req.user.id, at: new Date(), recordedAt: new Date(), note: reason });
      await trip.save({ session });
    }
    return cancellation;
  });
  res.json(result);
}
async function parentState(req, res) {
  const studentId = await childFor(req);
  const assignment = await Assignment.findOne({ studentId }).lean();
  const vehicle = assignment ? await Vehicle.findById(assignment.vehicleId).populate('driverId', 'name phone').lean() : null;
  const cancellation = await Cancellation.findOne({ studentId, date: today() }).lean();
  const trips = await Trip.find({ 'students.studentId': studentId }).sort({ startedAt: -1 }).limit(20).lean();
  // Never expose other children's names, contacts, or pickup coordinates to a parent.
  const items = trips.map(t => ({ _id: t._id, kind: t.kind, date: t.date, status: t.status,
    registration: t.registration, startedAt: t.startedAt, completedAt: t.completedAt,
    student: t.students.find(s => String(s.studentId) === studentId),
    events: t.events.filter(e => String(e.studentId) === studentId),
    lastLocation: t.status === 'active' && String(assignment?.vehicleId) === String(t.vehicleId) ? t.lastLocation : null }));
  res.json({ date: today(), assignment, vehicle: vehicle ? { _id: vehicle._id, registration: vehicle.registration,
    type: vehicle.type, active: vehicle.active, driver: vehicle.driverId } : null, cancellation, trips: items });
}
async function history(req, res) {
  const filter = req.query.vehicleId ? { vehicleId: id(req.query.vehicleId) } : {};
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json({ trips: await Trip.find(filter).sort({ startedAt: -1 }).skip((page - 1) * 25).limit(25),
    total: await Trip.countDocuments(filter), page });
}
module.exports = { adminData, saveDriver, saveVehicle, assign, driverHome, password, start, position, event, complete, cancelPickup, parentState, history };
