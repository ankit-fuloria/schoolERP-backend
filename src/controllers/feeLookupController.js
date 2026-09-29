const mongoose = require('mongoose');
const Student = require('../models/Student');
const SchoolClass = require('../models/SchoolClass');

async function classes(req, res) {
  const rows = await SchoolClass.find(req.query.includeInactive === 'true' ? {} : { status: { $ne: 'inactive' } }).select('name grade section gradeBand studentCount status').sort({ grade: 1, section: 1 }).lean();
  res.json({ classes: rows.map(c => ({ ...c, id: c._id })) });
}

async function students(req, res) {
  const filter = {};
  if (req.query.classId) {
    if (!mongoose.isValidObjectId(req.query.classId)) return res.status(400).json({ message: 'Invalid class' });
    filter.classId = req.query.classId;
  }
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',');
    if (ids.length > 100 || ids.some(id => !mongoose.isValidObjectId(id))) return res.status(400).json({ message: 'Invalid student selection' });
    filter._id = { $in: ids };
  }
  if (req.query.search) {
    const query = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['name', 'admissionNo', 'fatherPhone', 'motherPhone', 'parentDashboardPhone'].map(key => ({ [key]: { $regex: query, $options: 'i' } }));
  }
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 12));
  const rows = await Student.find(filter)
    .select('name admissionNo rollNo classId fatherName motherName fatherPhone motherPhone siblingIds admissionDate status profileImageUrl')
    .populate('classId', 'name grade section gradeBand').sort({ name: 1 }).limit(limit).lean();
  // Payment lookup must not expose medical, identity documents, or admission records.
  res.json({ students: rows.map(s => ({ id: s._id, name: s.name, admissionNo: s.admissionNo,
    rollNo: s.rollNo, status: s.status, fatherName: s.fatherName, motherName: s.motherName,
    fatherPhone: s.fatherPhone, motherPhone: s.motherPhone, siblingIds: s.siblingIds,
    admissionDate: s.admissionDate, profileImageUrl: s.profileImageUrl,
    class: s.classId ? { id: s.classId._id, name: s.classId.name, grade: s.classId.grade,
      section: s.classId.section, gradeBand: s.classId.gradeBand } : null })) });
}
module.exports = { classes, students };
