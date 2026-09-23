const mongoose = require('mongoose');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { register } = require('./context');
const cache = new Map();
const keyPath = process.env.TENANT_KEY_FILE || path.join(__dirname, '../../.tenant-db.key');

function encryptionKey(create = false) {
  let value = process.env.TENANT_DB_ENCRYPTION_KEY;
  if (!value) {
    if (!fs.existsSync(keyPath) && create) {
      try { fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    value = fs.readFileSync(keyPath, 'utf8').trim();
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('Invalid tenant encryption key');
  return key;
}
function encrypt(uri) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(true), iv);
  const body = Buffer.concat([cipher.update(uri, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(v => v.toString('base64')).join('.');
}
function decrypt(value) {
  const [iv, tag, body] = value.split('.').map(v => Buffer.from(v, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8');
}
function identity(uri, allowDefault = false) {
  const client = new mongoose.mongo.MongoClient(uri);
  const options = client.options;
  const dbName = options.dbName;
  if (!allowDefault && (!dbName || dbName === 'test')) throw Object.assign(new Error('Specify a dedicated database name in the MongoDB URL (not test)'), { status: 400 });
  const hosts = options.srvHost || options.hosts.map(h => h.toString().toLowerCase()).sort().join(',');
  return crypto.createHash('sha256').update(`${hosts}/${dbName}`).digest('hex');
}
async function probe(uri) {
  let connection;
  try {
    identity(uri);
    connection = await mongoose.createConnection(uri, { maxPoolSize: 1, serverSelectionTimeoutMS: 8000 }).asPromise();
    const hello = await connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('Replica set required');
    return fingerprint(connection, hello);
  } catch (_) {
    throw Object.assign(new Error('Cannot use this MongoDB URL. Provide a reachable, dedicated database on a replica set or Atlas cluster.'), { status: 400 });
  } finally { if (connection) await connection.close(); }
}
async function fingerprint(connection, hello) {
  hello ||= await connection.db.admin().command({ hello: 1 });
  const options = connection.getClient().options;
  const topology = hello.hosts?.length ? `${hello.setName}:${[...hello.hosts].map(h => h.toLowerCase()).sort().join(',')}`
    : options.srvHost || options.hosts.map(h => h.toString().toLowerCase()).sort().join(',');
  return crypto.createHash('sha256').update(`${topology}/${connection.name}`).digest('hex');
}
async function acquire(branch) {
  if (branch.legacy) return { connection: mongoose.connection, release() {} };
  const id = String(branch._id);
  let entry = cache.get(id);
  if (!entry) {
    if (cache.size >= 50) {
      const idle = [...cache].filter(([, e]) => e.users === 0).sort((a,b) => a[1].used - b[1].used)[0];
      if (!idle) throw Object.assign(new Error('Branch connection capacity reached. Try again shortly.'), { status: 503 });
      cache.delete(idle[0]);
      // Reserve the next entry without yielding, so concurrent requests share it.
      idle[1].promise.then(connection => connection.close()).catch(() => {});
    }
    const pending = mongoose.createConnection(decrypt(branch.encryptedUri), {
      maxPoolSize: 5, serverSelectionTimeoutMS: 8000, maxIdleTimeMS: 60000,
    });
    entry = { users: 0, used: Date.now(), promise: pending.asPromise().then(async connection => {
      register(connection);
      await Promise.all(Object.values(connection.models).map(model => model.init()));
      return connection;
    }).catch(async error => { await pending.close().catch(() => {}); throw error; }) };
    cache.set(id, entry);
  }
  entry.users++;
  try {
    const connection = await entry.promise;
    return { connection, release() { entry.users--; entry.used = Date.now(); } };
  } catch (_) {
    entry.users--; cache.delete(id);
    throw Object.assign(new Error('This branch database is temporarily unavailable'), { status: 503 });
  }
}
async function close() {
  await Promise.allSettled([...cache.values()].map(async e => (await e.promise).close())); cache.clear();
}
module.exports = { encrypt, decrypt, identity, fingerprint, probe, acquire, close };
