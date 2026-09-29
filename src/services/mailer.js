const nodemailer = require('nodemailer');
const { render } = require('./emailTemplate');

function smtpOptions(env = process.env) {
  const port = Number(env.SMTP_PORT || 465);
  if (![465, 587].includes(port)) throw new Error('SMTP_PORT must be 465 or 587');
  return {
    host: env.SMTP_HOST || 'smtp.hostinger.com', port, secure: port === 465,
    requireTLS: port === 587,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2' },
  };
}

let transport;
function getTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) throw new Error('SMTP credentials are not configured');
  transport ||= nodemailer.createTransport(smtpOptions());
  return transport;
}

function message(mail) {
  return {
    from: { name: 'Lavener Holdings', address: process.env.SMTP_USER || 'noreply@lavener.com' },
    to: mail.to, subject: mail.subject, ...render(mail),
    messageId: `<${mail._id}@lavener.com>`,
  };
}

const send = mail => getTransport().sendMail(mail);
const verify = () => getTransport().verify();
module.exports = { smtpOptions, message, send, verify };
