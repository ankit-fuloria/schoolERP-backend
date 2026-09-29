require('dotenv').config();
const mailer = require('../src/services/mailer');

mailer.verify().then(() => {
  console.log('Hostinger SMTP connection and authentication verified. No email was sent.');
}).catch(error => {
  const code = ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ESOCKET'].includes(error.code) ? error.code : 'VERIFY_FAILED';
  console.error(`SMTP verification failed (${code}). Check backend credentials, mailbox status and network access.`);
  process.exitCode = 1;
});
