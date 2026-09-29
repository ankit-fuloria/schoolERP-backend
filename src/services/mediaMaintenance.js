const fs = require('node:fs/promises');
const path = require('node:path');
const files = require('./mediaStorage');
const legacy = require('./legacyMedia');
const Media = require('../models/Media');
const platform = require('../tenancy/platform');
const { runBranch } = require('../tenancy/access');

async function migrateBranch(school, branch, apply) {
  const uploadedBy = (await require('../models/User').findOne({ role: 'principal' }).select('_id'))?._id || school._id;
  let count = 0;
  for (const [module, Model] of Object.entries(legacy.models())) {
    for await (const entity of Model.find().lean().cursor()) {
      const changes = {};
      for (const field of legacy.fields(Model)) {
        const values = Array.isArray(entity[field]) ? entity[field] : [entity[field]];
        const migrated = [];
        for (const value of values) {
          const folder = `${module === 'staff' ? 'staff' : module.slice(0, -1)}-documents`;
          if (typeof value !== 'string' || !value.startsWith(`/uploads/${folder}/`)) { migrated.push(value); continue; }
          const filename = path.basename(value);
          if (value !== `/uploads/${folder}/${filename}`) files.fail(400, 'Invalid legacy path');
          const bytes = await fs.readFile(path.join(legacy.root(), folder, filename));
          files.type(bytes); count++;
          if (!apply) { migrated.push(value); continue; }
          const purpose = field === 'profileImageUrl' ? 'photos' : field === 'signatureDocumentUrl' ? 'signatures' : 'documents';
          const media = await files.save({ bytes, originalName: filename, module, purpose, schoolId: school._id, branchId: branch._id, uploadedBy, allowLarge: true });
          await Media.updateOne({ _id: media._id }, { status: 'attached', entityId: entity._id });
          migrated.push(files.url(media));
        }
        if (apply && migrated.some((v, i) => v !== values[i])) changes[field] = Array.isArray(entity[field]) ? migrated : migrated[0];
      }
      if (Object.keys(changes).length) await Model.updateOne({ _id: entity._id }, { $set: changes });
    }
  }
  const Document = require('../models/Transport').Document;
  for await (const doc of Document.find({ bytes: { $exists: true } }).cursor()) {
    files.type(doc.bytes); count++;
    if (apply) {
      if (!await Media.exists({ _id: doc._id })) {
        await files.save({ bytes: doc.bytes, originalName: doc.name, module: 'transport', purpose: 'documents', uploadedBy: doc.uploadedBy,
          schoolId: school._id, branchId: branch._id, id: doc._id, allowLarge: true });
      }
      await Document.updateOne({ _id: doc._id }, { $unset: { bytes: 1 } });
    }
  }
  return count;
}
async function cleanupBranch(apply) {
  const referenced = new Set();
  for (const [module, Model] of Object.entries(legacy.models())) {
    for await (const entity of Model.find().lean().cursor()) {
      files.references(entity).forEach(id => referenced.add(id));
      if (module === 'transport') for (const field of ['licenceDocument', 'photo']) if (entity[field]) referenced.add(entity[field]);
    }
  }
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  let count = 0;
  for await (const media of Media.find({ updatedAt: { $lt: cutoff } }).cursor()) {
    if (referenced.has(String(media._id))) continue;
    count++;
    if (apply) {
      const claimed = await Media.findOneAndUpdate({ _id: media._id, updatedAt: { $lt: cutoff } }, { status: 'deleting' }, { new: true });
      if (!claimed) continue;
      // Re-check current references immediately before deleting.
      const checks = await Promise.all(Object.values(legacy.models()).map(Model => Model.exists(legacy.filter(Model, files.url(media)))));
      const driver = await legacy.models().transport.exists({ $or: [{ licenceDocument: String(media._id) }, { photo: String(media._id) }] });
      if (checks.some(Boolean) || driver) { await Media.updateOne({ _id: media._id }, { status: 'attached' }); continue; }
      await fs.unlink(files.absolute(media.path)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      await Media.deleteOne({ _id: media._id });
    }
  }
  return count;
}
async function run({ apply = false, migrate = false } = {}) {
  const { School, Branch, Media: Logo } = platform.get();
  let count = 0;
  for await (const branch of Branch.find().select('+encryptedUri').cursor()) {
    const school = await School.findById(branch.schoolId);
    if (school) count += await runBranch(school, branch, () => migrate ? migrateBranch(school, branch, apply) : cleanupBranch(apply));
  }
  if (migrate) {
    for await (const school of School.find({ logoUrl: /^\/uploads\/school-logos\// }).cursor()) {
      const bytes = await fs.readFile(path.join(legacy.root(), 'school-logos', path.basename(school.logoUrl)));
      files.type(bytes); count++;
      if (apply) {
        const owner = await platform.get().Owner.findOne().select('_id');
        if (!owner) files.fail(400, 'An owner account is required to migrate logos');
        const media = await files.save({ bytes, originalName: path.basename(school.logoUrl), module: 'logos', purpose: 'logos', schoolId: school._id,
          uploadedBy: owner._id, Model: Logo, allowLarge: true });
        school.logoUrl = files.url(media, true); await school.save();
        await Logo.updateOne({ _id: media._id }, { status: 'attached', entityId: school._id });
      }
    }
  } else {
    const cutoff = new Date(Date.now() - 48 * 3600000);
    for await (const media of Logo.find({ updatedAt: { $lt: cutoff } }).cursor()) {
      if (await School.exists({ logoUrl: files.url(media, true) })) continue;
      count++;
      if (apply) {
        if (!await Logo.findOneAndUpdate({ _id: media._id, updatedAt: { $lt: cutoff } }, { status: 'deleting' })) continue;
        if (await School.exists({ logoUrl: files.url(media, true) })) { await Logo.updateOne({ _id: media._id }, { status: 'attached' }); continue; }
        await fs.unlink(files.absolute(media.path)).catch(e => { if (e.code !== 'ENOENT') throw e; }); await Logo.deleteOne({ _id: media._id });
      }
    }
  }
  return count;
}
module.exports = { run, migrateBranch, cleanupBranch };
module.exports.start = () => {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await run({ apply: true }); }
    catch (_) { console.error('Media cleanup failed; retrying on the next scheduled run'); }
    finally { running = false; }
  }, 24 * 60 * 60 * 1000);
  timer.unref();
};
