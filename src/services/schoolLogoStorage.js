const fs = require('node:fs/promises');
const path = require('node:path');
const files = require('./mediaStorage');
const platform = require('../tenancy/platform');

async function validate(logoUrl, ownerId, schoolId) {
  if (logoUrl?.startsWith('/uploads/')) {
    if (!schoolId || !await platform.get().School.exists({ _id: schoolId, logoUrl })) files.fail(400, 'Upload a logo for this school');
    return;
  }
  if (!logoUrl || !logoUrl.startsWith('/api/owner/media/')) return;
  const id = logoUrl.slice('/api/owner/media/'.length);
  if (!/^[a-f\d]{24}$/i.test(id)) files.fail(400, 'Invalid school logo');
  const media = await platform.get().Media.findOne({ _id: id, module: 'logos', status: { $ne: 'deleting' } });
  if (!media || (media.schoolId ? String(media.schoolId) !== String(schoolId) : String(media.uploadedBy) !== String(ownerId))) files.fail(400, 'Select a logo uploaded for this school');
}
async function reserve(logoUrl, schoolId, session) {
  if (!logoUrl?.startsWith('/api/owner/media/')) return;
  const result = await platform.get().Media.findOneAndUpdate({ _id: logoUrl.slice('/api/owner/media/'.length), module: 'logos', status: { $ne: 'deleting' },
    $or: [{ schoolId: null }, { schoolId }] }, { schoolId, entityId: schoolId, status: 'attached' }, { session, new: true });
  if (!result) files.fail(409, 'This logo has expired or is already assigned to another school');
}
async function bind(school) {
  if (!school.logoUrl?.startsWith('/api/owner/media/')) return;
  const media = await platform.get().Media.findById(school.logoUrl.slice('/api/owner/media/'.length));
  if (!media) return;
  if (media.schoolId && String(media.schoolId) !== String(school._id)) files.fail(409, 'Logo belongs to another school');
  const destination = path.join('schools', String(school._id), 'school', 'logos', path.basename(media.path));
  if (media.path !== destination) {
    await fs.mkdir(path.dirname(files.absolute(destination)), { recursive: true });
    // Copy first so a failed DB update never leaves the old reference unreadable.
    await fs.copyFile(files.absolute(media.path), files.absolute(destination));
    const old = media.path;
    media.path = destination; media.schoolId = school._id; media.entityId = school._id; media.status = 'attached';
    await media.save();
    await fs.unlink(files.absolute(old)).catch(() => {});
  }
}
module.exports = { validate, reserve, bind };
