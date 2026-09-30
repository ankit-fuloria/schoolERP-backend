const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
require('../src/models/User');
const { initialPassword, publicEmail, provisionForStudent } = require('../src/services/parentProvisioning');

test('initial parent password is uppercase school code followed by student birth year', () => {
  assert.equal(initialPassword(' abcs1120 ', '2026-01-23'), 'ABCS11202026');
  assert.equal(initialPassword('ABCS1120', new Date('2026-01-23T00:00:00.000Z')), 'ABCS11202026');
  assert.throws(() => initialPassword('', '2026-01-23'), /School code/);
  assert.throws(() => initialPassword('ABCS1120', 'not-a-date'), /School code/);
});

test('internal parent login email is not exposed in auth response', () => {
  assert.equal(publicEmail({ role: 'parent', email: 'parent+9876543210@parent-login.schoolo.invalid' }), '');
  assert.equal(publicEmail({ role: 'parent', email: 'parent@example.com' }), 'parent@example.com');
});

test('new parent receives the derived password and selected phone', async () => {
  const model = mongoose.models.User;
  const originalFind = model.find;
  const originalCreate = model.create;
  let created;
  model.find = async () => [];
  model.create = async (value) => { created = value; return value; };
  try {
    const student = { _id: 'child-1', name: 'Child', dateOfBirth: new Date('2026-01-23'),
      parentDashboardPhoneType: 'mother', parentDashboardPhone: '9876543210', motherName: 'Mother' };
    await provisionForStudent(student, 'abcs1120');
    assert.equal(created.role, 'parent');
    assert.equal(created.phone, '9876543210');
    assert.deepEqual(created.childStudentIds, ['child-1']);
    assert.equal(await bcrypt.compare('ABCS11202026', created.passwordHash), true);
  } finally {
    model.find = originalFind;
    model.create = originalCreate;
  }
});

test('existing parent gets another child without a password reset', async () => {
  const model = mongoose.models.User;
  const originalFind = model.find;
  const originalUpdateOne = model.updateOne;
  const originalCreate = model.create;
  let update;
  model.find = async () => [{ _id: 'parent-1', role: 'parent', active: true }];
  model.updateOne = async (...args) => { update = args; };
  model.create = async () => { throw new Error('must not create a second parent'); };
  try {
    await provisionForStudent({ _id: 'child-2', parentDashboardPhone: '9876543210' }, 'ABCS1120');
    assert.deepEqual(update, [{ _id: 'parent-1' }, { $addToSet: { childStudentIds: 'child-2' } }]);
  } finally {
    model.find = originalFind;
    model.updateOne = originalUpdateOne;
    model.create = originalCreate;
  }
});
