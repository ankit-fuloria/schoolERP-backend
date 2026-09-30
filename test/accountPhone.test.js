const { test } = require('node:test');
const assert = require('node:assert/strict');
const phone = require('../src/utils/accountPhone');

test('phone lookup accepts common Indian formatting without matching partial numbers', () => {
  assert.equal(phone.required('+91 98765 43210'), '9876543210');
  assert.match('9876543210', phone.pattern('+91 98765 43210'));
  assert.match('+91 98765-43210', phone.pattern('9876543210'));
  assert.doesNotMatch('9876543211', phone.pattern('9876543210'));
  assert.equal(phone.pattern('person@example.com'), null);
  assert.throws(() => phone.required(''), /7-15 digits/);
});
