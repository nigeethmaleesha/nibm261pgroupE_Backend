const express = require('express');
const estimateController = require('../controllers/estimateController');
const repairJobController = require('../controllers/repairJobController');
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

// Customer estimate context endpoint.
router.get(
  '/:jobIdentifier/estimate',
  protect,
  authorizeRoles('customer', 'owner_staff'),
  estimateController.getEstimateContext
);

module.exports = router;
