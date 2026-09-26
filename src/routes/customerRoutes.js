const express = require('express');
const customerEstimateController = require('../controllers/customerEstimateController');
const customerJobController = require('../controllers/customerJobController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

// SCRUM-104: return the authenticated customer's own repair jobs only.
// Ownership is enforced at the service/repository layer; querying by
// req.user._id makes cross-customer (IDOR) access structurally impossible.
router.get(
  '/my-jobs',
  protect,
  authorizeRoles('customer'),
  customerJobController.listMyJobs
);

// SCRUM-15: customer-only, ownership-checked, public-safe estimate DTO.
router.get(
  '/jobs/:jobIdentifier/current-estimate',
  protect,
  authorizeRoles('customer'),
  customerEstimateController.getCurrentEstimate
);

module.exports = router;

