const express = require('express');
const estimateController = require('../controllers/estimateController');
const estimateRevisionController = require('../controllers/estimateRevisionController');
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

// Customer estimate decision endpoint (approve / reject).
router.post(
  '/:jobIdentifier/estimate-decision',
  protect,
  authorizeRoles('customer'),
  estimateController.recordEstimateDecision
);

// Legacy staff estimate-context alias. SCRUM-15 customers must use
// /api/customer/jobs/:jobIdentifier/current-estimate so diagnosis/internal
// context can never be exposed through the customer API surface.
router.get(
  '/:jobIdentifier/estimate',
  protect,
  authorizeRoles('owner_staff'),
  estimateController.getEstimateContext
);

module.exports = router;
