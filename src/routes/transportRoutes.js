const router = require('express').Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const wrap = require('../middleware/asyncHandler');
const c = require('../controllers/transportController');
router.use(requireAuth);
router.get('/driver/home', requireRole('driver'), wrap(c.driverHome));
router.put('/driver/password', requireRole('driver'), wrap(c.password));
router.post('/driver/trips', requireRole('driver'), wrap(c.start));
router.post('/driver/trips/:id/location', requireRole('driver'), wrap(c.position));
router.post('/driver/trips/:id/events', requireRole('driver'), wrap(c.event));
router.post('/driver/trips/:id/complete', requireRole('driver'), wrap(c.complete));
router.get('/parent/state', requireRole('parent'), wrap(c.parentState));
router.post('/parent/cancel', requireRole('parent'), wrap(c.cancelPickup));
router.use(requireRole('principal', 'staff'), requirePermission('transport'));
const files = require('../services/mediaStorage');
router.post('/documents', files.upload(), wrap(files.handler('transport')));
router.get('/documents/:id', wrap(async (req, res) => {
  if (!require('mongoose').isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid document' });
  const doc = await require('../models/Media').findOne({ _id: req.params.id, module: 'transport', ...files.context(req) });
  if (doc) return files.send(res, doc);
  // Compatibility for existing database-backed documents until migration.
  const old = await require('../models/Transport').Document.findById(req.params.id);
  if (!old?.bytes) return res.status(404).json({ message: 'Document not found' });
  res.set({ 'Cache-Control': 'no-store', 'Content-Type': old.mime, 'X-Content-Type-Options': 'nosniff' }).send(old.bytes);
}));
router.get('/admin', wrap(c.adminData));
router.get('/live', wrap(async (req, res) => {
  res.json({ trips: await require('../models/Transport').Trip.find({ status: 'active' }).sort({ startedAt: -1 }).lean() });
}));
router.get('/history', wrap(c.history));
router.post('/drivers', wrap(async (req, res) => { await files.validateReferences(req, 'transport', req.body); await c.saveDriver(req, res); }));
router.patch('/drivers/:id', wrap(async (req, res) => { await files.validateReferences(req, 'transport', req.body); await c.saveDriver(req, res); }));
router.post('/vehicles', wrap(c.saveVehicle));
router.patch('/vehicles/:id', wrap(c.saveVehicle));
router.put('/vehicles/:id/students', wrap(c.assign));
router.use((err, req, res, next) => {
  if (err.name === 'MulterError') return res.status(400).json({ message: 'Upload one image up to 400 KB' });
  next(err);
});
module.exports = router;
