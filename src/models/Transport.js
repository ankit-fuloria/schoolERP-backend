const mongoose = require('mongoose');
const { tenantModel } = require('../tenancy/context');
const ref = (model, required = false) => ({ type: mongoose.Schema.Types.ObjectId, ref: model, required });
const schema = fields => new mongoose.Schema(fields, { timestamps: true });
const location = new mongoose.Schema({ latitude: Number, longitude: Number, accuracy: Number, capturedAt: Date }, { _id: false });
const driverSchema = schema({ userId: { ...ref('User', true), unique: true }, name: String,
  phone: { type: String, unique: true }, email: String, address: String, emergencyContact: String,
  licenceNumber: String, licenceExpiry: Date, licenceDocument: String, photo: String,
  mustChangePassword: { type: Boolean, default: true }, active: { type: Boolean, default: true } });
const vehicleSchema = schema({ registration: { type: String, required: true, unique: true },
  type: String, capacity: { type: Number, required: true, min: 1, max: 100 },
  driverId: ref('TransportDriver'), insuranceExpiry: Date, fitnessExpiry: Date, photo: String,
  active: { type: Boolean, default: true }, revision: { type: Number, default: 0 } });
vehicleSchema.index({ driverId: 1 }, { unique: true, partialFilterExpression: { driverId: { $type: 'objectId' }, active: true } });
const assignmentSchema = schema({ studentId: { ...ref('Student', true), unique: true }, vehicleId: ref('TransportVehicle', true),
  pickup: { type: Boolean, default: true }, dropoff: { type: Boolean, default: true }, instructions: String });
const cancellationSchema = schema({ studentId: ref('Student', true), vehicleId: ref('TransportVehicle', true),
  date: String, reason: String, parentId: ref('User', true) });
cancellationSchema.index({ studentId: 1, date: 1 }, { unique: true });
const tripSchema = schema({ vehicleId: ref('TransportVehicle', true), driverId: ref('TransportDriver', true),
  registration: String, driverName: String, driverPhone: String, date: String,
  kind: { type: String, enum: ['pickup', 'dropoff'], required: true },
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  startedAt: Date, completedAt: Date, lastLocation: location,
  students: [{ studentId: ref('Student', true), name: String, admissionNo: String, address: String,
    contact: String, instructions: String, status: String, note: String,
    pickupLocation: location, dropLocation: location, pickedAt: Date, droppedAt: Date,
    locationException: String, _id: false }],
  events: [{ eventId: String, studentId: ref('Student'), action: String,
    actorId: ref('User'), at: Date, recordedAt: Date, note: String, location, _id: false }],
});
tripSchema.index({ vehicleId: 1, date: 1, kind: 1 }, { unique: true });
tripSchema.index({ vehicleId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
tripSchema.index({ driverId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
const locationSchema = schema({ tripId: ref('TransportTrip', true), location });
locationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 });
module.exports = {
  Document: tenantModel('TransportDocument', schema({ name: String, mime: String, bytes: Buffer, uploadedBy: ref('User', true) })),
  Driver: tenantModel('TransportDriver', driverSchema), Vehicle: tenantModel('TransportVehicle', vehicleSchema),
  Assignment: tenantModel('TransportAssignment', assignmentSchema), Cancellation: tenantModel('TransportCancellation', cancellationSchema),
  Trip: tenantModel('TransportTrip', tripSchema), Position: tenantModel('TransportPosition', locationSchema),
};
