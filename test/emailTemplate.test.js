const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodemailer = require('nodemailer');
const { render } = require('../src/services/emailTemplate');
const { smtpOptions, message } = require('../src/services/mailer');

test('Hostinger SMTP uses encrypted transport on both supported ports', () => {
  const options = smtpOptions({ SMTP_USER: 'test@example.com', SMTP_PASSWORD: 'not-real' });
  assert.equal(options.host, 'smtp.hostinger.com');
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.equal(options.tls.minVersion, 'TLSv1.2');
  assert.equal(smtpOptions({ SMTP_PORT: '587' }).requireTLS, true);
  assert.equal(smtpOptions({ SMTP_PORT: '587' }).secure, false);
  assert.throws(() => smtpOptions({ SMTP_PORT: '25' }));
});

test('all account events have branded HTML, plaintext and bundled inline graphics', () => {
  for (const [key, heading] of [
    ['school:1:recipient', 'Welcome to School Setu'],
    ['subscription:1:recipient', 'Subscription updated'],
    ['invoice:1:unpaid:recipient', 'Your subscription bill'],
    ['invoice:1:paid:recipient', 'Payment recorded'],
    ['invoice:1:void:recipient', 'Bill cancelled'],
    ['overdue:1:recipient', 'Subscription overdue'],
    ['old-notification', 'School Setu account update'],
  ]) {
    const result = render({ key, subject: 'School account', text: 'Amount: INR 1000.00\nDue: 2026-10-14\nPlease check your dashboard.' });
    assert.ok(result.html.includes(heading));
    assert.ok(result.html.includes('Lavener Holdings'));
    assert.ok(result.html.includes('INR 1000.00'));
    assert.ok(result.text.includes('Lavener Holdings'));
    assert.equal(result.attachments.length, 2);
    for (const attachment of result.attachments) {
      assert.ok(fs.existsSync(attachment.path));
      assert.ok(result.html.includes(`cid:${attachment.cid}`));
    }
  }
});

test('school-supplied content cannot inject HTML or links', () => {
  const result = render({ subject: '<script>bad()</script>', text: 'School: <img src=x onerror=bad()>\n<a href="https://evil.test">click</a>' });
  assert.ok(!result.html.includes('<script>'));
  assert.ok(!result.html.includes('<img src=x'));
  assert.ok(result.html.includes('&lt;script&gt;'));
  assert.ok(result.html.includes('&lt;img'));
  assert.ok(!result.html.includes('href="https://evil.test"'));
});

test('actual MIME output embeds graphics and both email alternatives without SMTP', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const result = await transport.sendMail(message({ _id: 'fixture', key: 'invoice:1:paid:recipient', to: 'test@example.test', subject: 'Payment recorded', text: 'Amount: INR 1000.00' }));
  const raw = result.message.toString();
  assert.match(raw, /From: Lavener Holdings/);
  assert.match(raw, /Message-ID: <fixture@lavener.com>/);
  assert.match(raw, /Content-Type: text\/plain/);
  assert.match(raw, /Content-Type: text\/html/);
  assert.match(raw, /Content-ID: <lavener-wordmark>/);
  assert.match(raw, /Content-ID: <lavener-symbol>/);
});
