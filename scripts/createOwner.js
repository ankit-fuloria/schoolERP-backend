require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const platform = require('../src/tenancy/platform');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: node scripts/createOwner.js owner@example.com');
  const { Owner } = await platform.connect();
  if (await Owner.exists({ email })) { console.log('Owner already exists. Password was not changed.'); return; }
  const password = crypto.randomBytes(24).toString('base64url');
  const file = path.resolve('.owner-initial-credentials.txt');
  // Never print the secret to terminal logs, or overwrite an existing credential file.
  fs.writeFileSync(file, `Sign in through the Flutter app.\nEmail: ${email}\nPassword: ${password}\n`, { mode: 0o600, flag: 'wx' });
  try { await Owner.create({ email, name: 'Owner Administrator', passwordHash: await bcrypt.hash(password, 12) }); }
  catch (error) { fs.unlinkSync(file); throw error; }
  console.log(`Owner created. Initial credentials are stored in ${file}`);
}
main().catch(error => { console.error(error.message.includes('Usage:') ? error.message : 'Owner creation failed; no credentials were printed. Check platform database configuration.'); process.exitCode = 1; }).finally(() => platform.close());
