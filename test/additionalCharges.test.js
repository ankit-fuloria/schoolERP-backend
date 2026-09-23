const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Student = require('../src/models/Student');
const SchoolClass = require('../src/models/SchoolClass');
const FeeRecord = require('../src/models/FeeRecord');
const Transaction = require('../src/models/Transaction');
const FeeStructure = require('../src/models/FeeStructure');
const structureController = require('../src/controllers/feeStructureController');
const charges = require('../src/controllers/additionalChargesController');
const fees = require('../src/controllers/feesController');
let mongo, app, first, second, structure;
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('charges'));
  await Promise.all([FeeRecord.init(), Transaction.init(), FeeStructure.init()]);
  const a = await SchoolClass.create({ name: '1st A', grade: '1st', section: 'A', gradeBand: 'Primary' });
  const b = await SchoolClass.create({ name: '2nd A', grade: '2nd', section: 'A', gradeBand: 'Primary' });
  first = await Student.create({ name: 'First', admissionNo: '1', classId: a._id });
  second = await Student.create({ name: 'Second', admissionNo: '2', classId: b._id });
  app = express(); app.use(express.json());
  app.put('/structure', wrap(structureController.updateFeeStructure));
  app.get('/status', wrap(charges.status)); app.post('/pay', wrap(charges.pay));
  app.get('/monthly', wrap(fees.getMonthlyStatus));
  app.post('/payment', wrap(fees.createPayment));
  app.use((e,req,res,next) => res.status(e.status || (e.code === 11000 ? 409 : 500)).json({ message: e.message }));
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test('custom charge structure validates names, money and every class', async () => {
  const input = { additionalCharges: [
    { name: 'Activity', sameForAll: true, amount: 500 },
    { name: 'Books', sameForAll: false, gradeAmounts: [{ grade: '1st', amount: 200 }, { grade: '2nd', amount: 350 }] },
  ] };
  structure = (await request(app).put('/structure').send(input).expect(200)).body;
  const bad = [
    [{ name: '', sameForAll: true, amount: 5 }],
    [{ name: 'A', sameForAll: true, amount: -1 }],
    [{ name: 'A', sameForAll: true, amount: 1.001 }],
    [{ name: 'A', sameForAll: true, amount: 1 }, { name: 'a', sameForAll: true, amount: 1 }],
    [{ name: 'Books', sameForAll: false, gradeAmounts: [{ grade: '1st', amount: 1 }] }],
  ];
  for (const additionalCharges of bad) await request(app).put('/structure').send({ additionalCharges }).expect(400);
  const a = (await request(app).get('/status').query({ studentId: String(first._id) }).expect(200)).body.charges;
  const b = (await request(app).get('/status').query({ studentId: String(second._id) }).expect(200)).body.charges;
  assert.deepEqual(a.map(c=>c.amount), [500,200]); assert.deepEqual(b.map(c=>c.amount), [500,350]);
  assert.ok(a.every(c=>c.status==='unpaid'));
});
test('payment is server-priced, atomic, session-specific and duplicate protected', async () => {
  const body = { studentId: first._id, chargeId: structure.additionalCharges[0]._id, paymentMode: 'cash', amount: 1 };
  await request(app).post('/pay').send({ ...body, paymentMode: 'upi' }).expect(400);
  const results = await Promise.all([request(app).post('/pay').send(body), request(app).post('/pay').send(body)]);
  assert.deepEqual(results.map(r=>r.status).sort(), [201,409]);
  assert.equal(await Transaction.countDocuments(), 1);
  assert.equal((await FeeRecord.findOne()).amount, 500);
  const result = (await request(app).get('/status').query({ studentId: String(first._id) }).expect(200)).body;
  assert.equal(result.charges[0].status,'paid'); assert.equal(result.charges[1].status,'unpaid');
  const monthly = (await request(app).get('/monthly').query({ studentId: String(first._id) }).expect(200)).body;
  assert.ok(monthly.months.every(m=>m.status !== 'paid'));
  const untouched = (await request(app).get('/status').query({ studentId: String(second._id) }).expect(200)).body;
  assert.ok(untouched.charges.every(c=>c.status==='unpaid'));
});
test('one payment settles months and other charges with a discounted, itemized receipt', async () => {
  structure.gradeFees = [{ grade: '1st', monthlyFee: 120 }, { grade: '2nd', monthlyFee: 150 }];
  await request(app).put('/structure').send(structure).expect(200);
  const booksId = String(structure.additionalCharges[1]._id);
  const body = { studentId: String(second._id), monthsCount: 2, chargeIds: [booksId],
    discountMode: 'percent', discountValue: 10, paymentMode: 'upi', transactionRef: 'UTR-123' };
  const response = await request(app).post('/payment').send(body).expect(201);
  const transaction = response.body.transaction;
  assert.equal(transaction.grossAmount, 650);
  assert.equal(transaction.discountAmount, 65);
  assert.equal(transaction.amount, 585);
  assert.equal(transaction.lineItems.length, 3);
  assert.equal(transaction.lineItems.reduce((sum, item) => sum + item.amount, 0), 585);
  assert.equal(transaction.lineItems.filter(item => item.kind === 'charge').length, 1);
  assert.equal(await FeeRecord.countDocuments({ studentId: second._id, transactionId: transaction._id }), 3);
  assert.equal((await request(app).get('/status').query({ studentId: String(second._id) })).body.charges[1].status, 'paid');
  await request(app).post('/payment').send(body).expect(409);
  assert.equal(await Transaction.countDocuments({ studentId: second._id }), 1);
  const amountOnly = await request(app).post('/payment').send({ studentId: String(first._id), monthsCount: 0,
    chargeIds: [String(structure.additionalCharges[1]._id)], discountMode: 'amount', discountValue: 25,
    paymentMode: 'cash' }).expect(201);
  assert.equal(amountOnly.body.transaction.amount, 175);
  await request(app).post('/payment').send({ ...body, studentId: first._id, chargeIds: [], monthsCount: 1,
    discountMode: 'amount', discountValue: 999 }).expect(400);
});
test('edits and removals preserve paid snapshots and older clients preserve configured charges', async () => {
  structure.additionalCharges[0].name = 'Renamed'; structure.additionalCharges[0].amount = 999;
  await request(app).put('/structure').send(structure).expect(200);
  let result = (await request(app).get('/status').query({ studentId: String(first._id) })).body;
  assert.equal(result.charges[0].name,'Activity'); assert.equal(result.charges[0].amount,500);
  await request(app).put('/structure').send({ gradeFees: [] }).expect(200);
  assert.equal((await FeeStructure.findOne()).additionalCharges.length,2);
  await request(app).put('/structure').send({ additionalCharges: [] }).expect(200);
  result = (await request(app).get('/status').query({ studentId: String(first._id) })).body;
  assert.equal(result.charges[0].status,'paid'); assert.equal(result.charges[0].archived,true);
});
