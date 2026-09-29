const fs = require('node:fs/promises');
const path = require('node:path');
const files = require('./mediaStorage');

function models() {
  return { students: require('../models/Student'), teachers: require('../models/Teacher'), staff: require('../models/Staff'), transport: require('../models/Transport').Driver };
}
function root() { return path.resolve(process.env.MEDIA_LEGACY_ROOT || path.join(__dirname, '../../uploads')); }
function fields(Model) { return Object.keys(Model.schema.paths).filter(p => /Url/.test(p) || ['licenceDocument', 'photo'].includes(p)); }
function filter(Model, url) { return { $or: fields(Model).map(field => ({ [field]: url })) }; }
async function sendLegacy(res, folder, name) {
  if (!['student-documents', 'teacher-documents', 'staff-documents', 'school-logos'].includes(folder) || name !== path.basename(name) || !/^[\w. -]+$/.test(name)) files.fail(400, 'Invalid legacy file');
  const filename = path.join(root(), folder, name);
  let bytes;
  try { bytes = await fs.readFile(filename); } catch (_) { files.fail(404, 'Media file is unavailable'); }
  const info = files.type(bytes);
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': info.mime, 'X-Content-Type-Options': 'nosniff' });
  res.send(bytes);
}
module.exports = { models, fields, filter, sendLegacy, root };
