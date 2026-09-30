const { test } = require('node:test');
const assert = require('node:assert/strict');
const { studentCreationError } = require('../src/controllers/studentController');

const valid = {
  name: 'New Student', admissionNo: 'ST-1', classId: 'class-id',
  gender: 'Female', dateOfBirth: '2018-05-10', category: 'SC',
  parentDashboardPhoneType: 'mother', motherPhone: '9876543210',
};

test('student creation requires each basic field and a selected parent login phone', () => {
  for (const key of ['name', 'admissionNo', 'classId', 'gender', 'dateOfBirth', 'category', 'parentDashboardPhoneType', 'motherPhone']) {
    assert.ok(studentCreationError({ ...valid, [key]: '' }), key);
  }
  assert.ok(studentCreationError({ ...valid, category: 'Invalid' }));
  assert.ok(studentCreationError({ ...valid, motherPhone: '123' }));
});

test('unselected parent phone, email, address and emergency contact are optional', () => {
  assert.equal(studentCreationError(valid), null);
  assert.equal(studentCreationError({ ...valid, fatherPhone: '', motherDetails: { email: '' } }), null);
  assert.equal(studentCreationError({ ...valid, motherPhone: '', motherDetails: { primaryPhone: '9876543210' } }), null);
  assert.equal(studentCreationError({ ...valid, parentDashboardPhoneType: 'father', fatherPhone: '9876543210', motherPhone: '' }), null);
});

test('conditional disability and reservation types remain required when selected', () => {
  assert.match(studentCreationError({ ...valid, hasDisability: true }), /disability/);
  assert.match(studentCreationError({ ...valid, hasReservation: true }), /reservation/);
});
