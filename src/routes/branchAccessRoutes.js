const express = require('express');
const platform = require('../tenancy/platform');
const { requireAuth, requireRole } = require('../middleware/auth');
const { checkSchool, runBranch, principalUser, sign, fail } = require('../tenancy/access');
const router = express.Router();
// 30-second in-memory cache for school branches
const branchCache = new Map();

router.use(requireAuth, requireRole('principal'));
router.get('/', async (req, res, next) => {
  try {
    const schoolIdStr = req.tenant.school._id.toString();
    const cached = branchCache.get(schoolIdStr);
    const now = Date.now();
    let branches;
    if (cached && cached.expiresAt > now) {
      branches = cached.branches;
    } else {
      branches = await platform.get().Branch.find({ schoolId: req.tenant.school._id, active: true }).select('name code');
      branchCache.set(schoolIdStr, { branches, expiresAt: now + 30000 });
    }
    res.json({ school: { id: req.tenant.school._id, name: req.tenant.school.name, code: req.tenant.school.code }, currentBranchId: req.tenant.branch._id, branches });
  } catch (error) { next(error); }
});
router.post('/switch', async (req, res, next) => {
  try {
    const { Principal, Branch } = platform.get();
    const principal = await Principal.findOne({ _id: req.user.principalId, schoolId: req.tenant.school._id, active: true });
    if (!principal) fail(403, 'Sign in again before switching branches');
    const branch = await Branch.findOne({ _id: req.body.branchId, schoolId: principal.schoolId, active: true }).select('+encryptedUri');
    await checkSchool(req.tenant.school, branch);
    const result = await runBranch(req.tenant.school, branch, async () => {
      const user = await principalUser(principal);
      return { token: sign(user), user: { id: user._id, name: user.name, email: user.email, role: user.role } };
    });
    res.json(result);
  } catch (error) { next(error); }
});
module.exports = router;
