const mongoose = require('mongoose');
let connection;
let models;

async function connect(uri = process.env.OWNER_MONGODB_URI || process.env.MONGODB_URI) {
  if (connection) return models;
  connection = await mongoose.createConnection(uri, {
    dbName: process.env.OWNER_DB_NAME || 'schoolo_platform',
    maxPoolSize: 5, serverSelectionTimeoutMS: 10000,
  }).asPromise();
  const schema = (fields) => new mongoose.Schema(fields, { timestamps: true });
  const ref = (name) => ({ type: mongoose.Schema.Types.ObjectId, ref: name, required: true });
  const Owner = connection.model('Owner', schema({
    email: { type: String, unique: true, required: true, lowercase: true },
    passwordHash: { type: String, required: true }, name: String,
    active: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0 },
  }));
  const School = connection.model('School', schema({
    name: { type: String, required: true }, code: { type: String, unique: true, required: true, lowercase: true, trim: true },
    logoUrl: { type: String, default: '' },
    active: { type: Boolean, default: true },
    subscription: {
      cycle: { type: String, enum: ['monthly', 'quarterly', 'annually'] },
      cycleAmountMinor: Number, monthlyMaintenanceMinor: Number,
      firstBillingDate: String, nextBillingDate: String,
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner' },
    },
  }));
  const branchSchema = schema({
    schoolId: ref('School'), name: { type: String, required: true }, code: { type: String, required: true },
    encryptedUri: { type: String, select: false },
    databaseKey: { type: String, unique: true, required: true, select: false },
    legacy: { type: Boolean, default: false }, active: { type: Boolean, default: true },
    isMain: { type: Boolean, default: false },
  });
  branchSchema.index({ schoolId: 1, code: 1 }, { unique: true });
  branchSchema.index({ schoolId: 1, isMain: 1 }, { unique: true, partialFilterExpression: { isMain: true } });
  const Branch = connection.model('Branch', branchSchema);
  const principalSchema = schema({ schoolId: ref('School'), email: { type: String, required: true },
    name: { type: String, required: true }, passwordHash: { type: String, required: true },
    active: { type: Boolean, default: true } });
  principalSchema.index({ schoolId: 1, email: 1 }, { unique: true });
  const Principal = connection.model('Principal', principalSchema);
  const invoiceSchema = schema({
    schoolId: ref('School'), number: { type: String, unique: true, required: true },
    description: { type: String, required: true },
    amountMinor: { type: Number, required: true, min: 1 }, currency: { type: String, default: 'INR' },
    dueDate: { type: String, required: true }, dueAt: { type: Date, required: true },
    status: { type: String, enum: ['unpaid', 'paid', 'void'], default: 'unpaid' },
    paidAt: Date, paymentReference: String, createdBy: ref('Owner'), updatedBy: ref('Owner'),
    billingDate: String, cycle: String, cycleAmountMinor: Number, maintenanceAmountMinor: Number,
  });
  invoiceSchema.index({ schoolId: 1, billingDate: 1 }, { unique: true, partialFilterExpression: { billingDate: { $type: 'string' } } });
  const Invoice = connection.model('Invoice', invoiceSchema);
  Invoice.schema.index({ schoolId: 1, status: 1, dueAt: 1 });
  const Mail = connection.model('Mail', schema({
    key: { type: String, unique: true, required: true },
    to: { type: String, required: true }, subject: String, text: String,
    sentAt: Date, leaseUntil: Date, attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now }, lastError: String,
  }));
  models = { Owner, School, Branch, Principal, Invoice, Mail };
  await Promise.all(Object.values(models).map(m => m.init()));
  return models;
}

module.exports = { connect, get: () => {
  if (!models) throw new Error('Platform database is unavailable');
  return models;
}, connection: () => connection, close: async () => {
  if (connection) await connection.close(); connection = null; models = null;
} };
