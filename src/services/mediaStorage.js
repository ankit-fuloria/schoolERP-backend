const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const multer = require('multer');
const Media = require('../models/Media');
const { storage } = require('../tenancy/context');

const MAX_BYTES = 400 * 1024;
const root = () => path.resolve(process.env.MEDIA_STORAGE_ROOT || path.join(__dirname, '../../storage'));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function absolute(relative) {
  const result = path.resolve(root(), relative);
  if (!result.startsWith(root() + path.sep)) fail(400, 'Invalid media path');
  return result;
}
function type(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { mime: 'image/png', ext: 'png' };
  if (bytes.length >= 4 && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) && bytes.subarray(-2).equals(Buffer.from('ffd9', 'hex'))) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (bytes.toString('ascii', 0, 5) === '%PDF-' && bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) return { mime: 'application/pdf', ext: 'pdf' };
  fail(400, 'Upload a valid JPEG, PNG, WebP image or PDF document');
}
const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 4, fieldSize: 1024 } });
function upload(field = 'document') {
  return (req, res, next) => parser.single(field)(req, res, error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Maximum upload size is 400 KB' : 'Upload one file with valid form data' });
    next();
  });
}
function context(req) {
  const scope = req.tenant || storage.getStore();
  if (!scope?.school?._id || !scope?.branch?._id) fail(400, 'School and branch context is required');
  return { schoolId: scope.school._id, branchId: scope.branch._id };
}
function url(media, owner = false) { return `/api/${owner ? 'owner/' : ''}media/${media._id}`; }
async function save({ bytes, originalName, module, purpose, schoolId, branchId, uploadedBy, Model = Media, id, allowLarge = false }) {
  if (!bytes?.length) fail(400, 'A file is required');
  if (!allowLarge && bytes.length > MAX_BYTES) fail(413, 'Maximum upload size is 400 KB');
  const fileType = type(bytes);
  if (purpose !== 'documents' && !fileType.mime.startsWith('image/')) fail(400, 'Select an image for this field');
  const _id = id || new mongoose.Types.ObjectId();
  const folder = schoolId
    ? path.join('schools', String(schoolId), branchId ? path.join('branches', String(branchId), module, purpose) : path.join('school', 'logos'))
    : path.join('drafts', 'owners', String(uploadedBy), 'logos');
  const relative = path.join(folder, `${_id}.${fileType.ext}`);
  await fs.mkdir(path.dirname(absolute(relative)), { recursive: true });
  await fs.writeFile(absolute(relative), bytes, { flag: 'wx', mode: 0o600 });
  try {
    return await Model.create({ _id, schoolId, branchId, module, purpose, path: relative, originalName: path.basename(originalName).slice(0, 200),
      mime: fileType.mime, size: bytes.length, uploadedBy });
  } catch (error) { await fs.unlink(absolute(relative)).catch(() => {}); throw error; }
}
function handler(module) {
  return async (req, res) => {
    const purpose = req.body.purpose || 'documents';
    if (!['photos', 'documents', 'signatures'].includes(purpose)) fail(400, 'Invalid media purpose');
    const media = await save({ ...context(req), bytes: req.file?.buffer, originalName: req.file?.originalname || 'file', module, purpose, uploadedBy: req.user.id });
    res.status(201).json({ id: media._id, fileName: media.originalName, name: media.originalName, documentUrl: url(media), size: media.size });
  };
}
function references(value, result = new Set()) {
  if (typeof value === 'string') {
    const match = value.match(/^\/api\/(?:owner\/)?media\/([a-f\d]{24})$/i);
    if (match) result.add(match[1]);
  } else if (Array.isArray(value)) value.forEach(v => references(v, result));
  else if (value && Object.getPrototypeOf(value) === Object.prototype) Object.values(value).forEach(v => references(v, result));
  return result;
}
async function validateReferences(req, module, body) {
  const legacyUrls = [];
  const collectLegacy = value => {
    if (typeof value === 'string' && value.startsWith('/uploads/')) legacyUrls.push(value);
    else if (Array.isArray(value)) value.forEach(collectLegacy);
    else if (value && Object.getPrototypeOf(value) === Object.prototype) Object.values(value).forEach(collectLegacy);
  };
  collectLegacy(body);
  if (legacyUrls.length) {
    const legacy = require('./legacyMedia');
    const Model = legacy.models()[module];
    for (const resource of new Set(legacyUrls)) {
      if (!await Model.exists(legacy.filter(Model, resource))) fail(400, 'Legacy media must already belong to this branch and section');
    }
  }
  const ids = [...references(body)];
  if (module === 'transport') for (const field of ['licenceDocument', 'photo']) {
    if (mongoose.isValidObjectId(body[field])) ids.push(body[field]);
  }
  if (!ids.length) return;
  const scope = context(req);
  const rows = await Media.find({ _id: { $in: ids }, module, status: { $ne: 'deleting' }, ...scope });
  const legacy = module === 'transport' ? await require('../models/Transport').Document.countDocuments({ _id: { $in: ids.filter(id => !rows.some(r => String(r._id) === String(id))) } }) : 0;
  if (rows.length + legacy !== new Set(ids).size) fail(400, 'Selected media does not belong to this school, branch or section');
  const reservation = await Media.updateMany({ _id: { $in: rows.map(r => r._id) }, status: { $ne: 'deleting' }, ...scope }, { $set: { updatedAt: new Date() } });
  if (reservation.matchedCount !== rows.length) fail(409, 'Media has expired. Upload it again');
}
async function attach(req, module, entity) {
  const ids = [...references(entity.toObject ? entity.toObject() : entity)];
  if (module === 'transport') for (const field of ['licenceDocument', 'photo']) if (mongoose.isValidObjectId(entity[field])) ids.push(entity[field]);
  if (ids.length) await Media.updateMany({ _id: { $in: ids }, module, ...context(req) }, { status: 'attached', entityId: entity._id });
}
async function send(res, media) {
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': media.mime,
    'Content-Disposition': `${media.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="${media._id}.${typeExtension(media.mime)}"` });
  try { await fs.access(absolute(media.path)); } catch (_) { fail(404, 'Media file is unavailable'); }
  return new Promise((resolve, reject) => res.sendFile(absolute(media.path), error => error ? reject(error) : resolve()));
}
function typeExtension(mime) { return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' })[mime] || 'bin'; }
module.exports = { MAX_BYTES, root, absolute, type, upload, context, url, save, handler, references, validateReferences, attach, send, fail };
