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
    billingRevision: { type: Number, default: 0 },
    pricing: {
      erpBaseMinor: Number, discountMinor: Number, erpNetMinor: Number,
      monthlyMaintenanceMinor: Number, freeMonths: Number,
      cycle: { type: String, enum: ['monthly', 'quarterly', 'annually'] },
      activationDate: String, firstMaintenanceDate: String,
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
    amountMinor: { type: Number, required: true, min: 0 }, currency: { type: String, default: 'INR' },
    dueDate: { type: String, required: true }, dueAt: { type: Date, required: true },
    status: { type: String, enum: ['unpaid', 'partial', 'paid', 'void'], default: 'unpaid' },
    kind: { type: String, enum: ['erp', 'maintenance', 'legacy'], default: 'legacy' },
    documentType: { type: String, enum: ['bill', 'legacy_invoice'] },
    subtotalMinor: Number, discountMinor: Number, taxPercent: Number, taxMinor: Number,
    paidMinor: { type: Number, default: 0 }, issuedAt: Date,
    periodStart: String, periodEnd: String,
    installments: [{ label: String, amountMinor: Number, dueDate: String, dueAt: Date }],
    paidAt: Date, paymentReference: String, createdBy: ref('Owner'), updatedBy: ref('Owner'),
    billingDate: String, cycle: String, cycleAmountMinor: Number, maintenanceAmountMinor: Number,
  });
  invoiceSchema.index({ schoolId: 1, billingDate: 1 }, { unique: true, partialFilterExpression: { billingDate: { $type: 'string' } } });
  const Invoice = connection.model('Invoice', invoiceSchema);
  Invoice.schema.index({ schoolId: 1, status: 1, dueAt: 1 });
  const Payment = connection.model('Payment', schema({
    schoolId: ref('School'), invoiceId: ref('Invoice'), createdBy: ref('Owner'),
    amountMinor: { type: Number, required: true, min: 1 },
    paymentDate: { type: String, required: true }, method: String, reference: String, notes: String,
    requestId: { type: String, required: true },
  }));
  Payment.schema.index({ invoiceId: 1, requestId: 1 }, { unique: true });
  const CompletedInvoice = connection.model('CompletedInvoice', schema({
    schoolId: ref('School'), billId: { ...ref('Invoice'), unique: true },
    number: { type: String, unique: true, required: true }, billNumber: String,
    schoolName: String, schoolCode: String, description: String, kind: String,
    amountMinor: Number, subtotalMinor: Number, discountMinor: Number,
    taxPercent: Number, taxMinor: Number, currency: String,
    periodStart: String, periodEnd: String, issuedAt: { type: Date, required: true },
    paymentDate: String, paymentReference: String, createdBy: ref('Owner'),
  }));
  const Expense = connection.model('Expense', schema({
    number: { type: String, unique: true, required: true },
    transactionDate: { type: String, required: true },
    amountMinor: { type: Number, required: true, min: 1 },
    category: { type: String, required: true }, payee: { type: String, required: true },
    description: { type: String, required: true }, method: String, reference: String, notes: String,
    requestId: { type: String, unique: true, required: true }, createdBy: ref('Owner'),
    status: { type: String, enum: ['recorded', 'void'], default: 'recorded' },
    voidReason: String, voidedAt: Date, voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner' },
  }));
  Expense.schema.index({ transactionDate: -1, createdAt: -1 });
  const PaymentSettings = connection.model('PaymentSettings', schema({
    key: { type: String, unique: true, default: 'default' },
    erpBaseMinor: { type: Number, default: 0 },
    maintenanceMinMinor: { type: Number, default: 0 }, maintenanceMaxMinor: { type: Number, default: 0 },
    freeMonths: { type: Number, default: 0 }, taxPercent: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner' },
  }));
  const Mail = connection.model('Mail', schema({
    key: { type: String, unique: true, required: true },
    to: { type: String, required: true }, subject: String, text: String,
    sentAt: Date, leaseUntil: Date, attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now }, lastError: String,
  }));
  const Media = connection.model('PlatformMedia', require('../models/Media').schema.clone());
  models = { Owner, School, Branch, Principal, Invoice, CompletedInvoice, Expense, Payment, PaymentSettings, Mail, Media };
  await Promise.all(Object.values(models).map(m => m.init()));
  return models;
}

module.exports = { connect, get: () => {
  if (!models) throw new Error('Platform database is unavailable');
  return models;
}, connection: () => connection, close: async () => {
  if (connection) await connection.close(); connection = null; models = null;
} };
