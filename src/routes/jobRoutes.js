const express = require('express');
const estimateController = require('../controllers/estimateController');
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

module.exports = router;
