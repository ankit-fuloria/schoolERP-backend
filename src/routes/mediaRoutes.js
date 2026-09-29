const router = require('express').Router();
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const wrap = require('../middleware/asyncHandler');
const Media = require('../models/Media');
const Student = require('../models/Student');
const User = require('../models/User');
const Teacher = require('../models/Teacher');
const Staff = require('../models/Staff');
const files = require('../services/mediaStorage');

async function allowed(req, media, resourceUrl = files.url(media)) {
  if (req.user.role === 'principal') return true;
  const photo = media.module === 'students' && media.purpose === 'photos';
  if (req.user.role === 'staff') {
    const staff = await Staff.findOne({ userId: req.user.id, status: { $ne: 'inactive' } });
    return !!staff && (staff.permissions.includes(media.module) || (photo && staff.permissions.some(p => ['fees', 'classes', 'transport', 'attendance', 'examinations'].includes(p))));
  }
  if (req.user.role === 'parent' && photo) {
    const user = await User.findById(req.user.id).select('childStudentIds');
    return !!user && !!await Student.exists({ _id: { $in: user.childStudentIds }, profileImageUrl: resourceUrl });
  }
  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return false;
    if (media.module === 'teachers') return !!await Teacher.exists({ _id: teacher._id, ...require('../services/legacyMedia').filter(Teacher, resourceUrl) });
    if (photo) return !!await Student.exists({ classId: { $in: teacher.assignments.map(a => a.classId) }, profileImageUrl: resourceUrl });
  }
  return false;
}
router.use(requireAuth);
router.get('/:id', wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid media ID' });
  const media = await Media.findOne({ _id: req.params.id, status: { $ne: 'deleting' }, ...files.context(req) });
  if (!media) return res.status(404).json({ message: 'Media not found' });
  if (!await allowed(req, media)) return res.status(403).json({ message: 'Media access denied' });
  await files.send(res, media);
}));
module.exports = router;
module.exports.legacy = [requireAuth, wrap(async (req, res) => {
  const modules = { 'student-documents': 'students', 'teacher-documents': 'teachers', 'staff-documents': 'staff' };
  const module = modules[req.params.folder];
  if (!module) return res.status(404).json({ message: 'Media not found' });
  const legacy = require('../services/legacyMedia');
  const Model = legacy.models()[module];
  const resource = `/uploads/${req.params.folder}/${req.params.name}`;
  const entity = await Model.findOne(legacy.filter(Model, resource));
  if (!entity) return res.status(404).json({ message: 'Media not found in this branch' });
  const media = { module, purpose: entity.profileImageUrl === resource ? 'photos' : 'documents' };
  if (!await allowed(req, media, resource)) return res.status(403).json({ message: 'Media access denied' });
  await legacy.sendLegacy(res, req.params.folder, req.params.name);
})];
