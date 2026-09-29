const express = require("express");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const {
  listFees,
  getFeesSummary,
  getMonthlyStatus,
  createPayment,
  listTransactions,
  createFee,
  disableFee,
  updateFee,
} = require("../controllers/feesController");
const { getFeeStructure, updateFeeStructure } = require("../controllers/feeStructureController");

const router = express.Router();

router.use(requireAuth, requireRole("principal", "staff"), requirePermission("fees"));
router.get('/classes', asyncHandler(require('../controllers/feeLookupController').classes));
router.get('/students', asyncHandler(require('../controllers/feeLookupController').students));

router.get("/structure", asyncHandler(getFeeStructure));
router.get('/charge-status', asyncHandler(require('../controllers/additionalChargesController').status));
router.post('/charge-payment', asyncHandler(require('../controllers/additionalChargesController').pay));
router.put("/structure", asyncHandler(updateFeeStructure));
router.get("/monthly-status", asyncHandler(getMonthlyStatus));
router.get("/transactions", asyncHandler(listTransactions));
router.post("/payment", asyncHandler(createPayment));
router.get("/", asyncHandler(listFees));
router.get("/summary", asyncHandler(getFeesSummary));
router.post("/", asyncHandler(createFee));
router.put("/:id", asyncHandler(updateFee));
router.delete("/:id", asyncHandler(disableFee));

module.exports = router;
