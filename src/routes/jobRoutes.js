const express = require('express');
const estimateController = require('../controllers/estimateController');
const estimateRevisionController = require('../controllers/estimateRevisionController');
const repairJobController = require('../controllers/repairJobController');
const customerJobController = require('../controllers/customerJobController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

// SCRUM-14 Jira-compatible endpoint alias.
// The existing application groups Owner/Staff operations under /api/staff,
// but the Jira subtask names POST /api/jobs/:id/estimates explicitly.
// Both routes call the same protected controller/service and therefore share
// validation, state checks, transaction handling and immutable persistence.
router.post(
  '/:jobIdentifier/estimates',
  protect,
  authorizeRoles('owner_staff'),
  estimateController.issueInitialEstimate
);

// Estimate revision aliases. Same controller/service as the /api/staff routes.
router.get(
  '/:jobIdentifier/estimates',
  protect,
  authorizeRoles('owner_staff'),
  estimateRevisionController.getEstimateHistory
);
router.get(
  '/:jobIdentifier/estimates/history',
  protect,
  authorizeRoles('customer', 'owner_staff'),
  estimateRevisionController.getEstimateHistory
);
router.post(
  '/:jobIdentifier/estimate-revisions',
  protect,
  authorizeRoles('owner_staff'),
  estimateRevisionController.issueRevisedEstimate
);


// SCRUM-11 Jira endpoint: Owner/Staff assigns or reassigns a technician.
// This aliases the staff route while preserving the exact Jira path.
router.patch(
  '/:jobIdentifier/assign',
  protect,
  authorizeRoles('owner_staff'),
  repairJobController.assignTechnician
);

// Customer estimate decision endpoint (approve / reject).
router.post(
  '/:jobIdentifier/estimate-decision',
  protect,
  authorizeRoles('customer'),
  estimateController.recordEstimateDecision
);

// SCRUM-109 Jira-compatible alias: public-safe tracking endpoint.
router.get(
  '/:jobIdentifier/track',
  protect,
  authorizeRoles('customer', 'owner_staff'),
  customerJobController.getJobTracking
);
router.get(
  '/:jobIdentifier/tracking',
  protect,
  authorizeRoles('customer', 'owner_staff'),
  customerJobController.getJobTracking
);

module.exports = router;
