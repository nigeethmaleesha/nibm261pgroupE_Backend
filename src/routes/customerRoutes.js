const express = require('express');
const customerEstimateController = require('../controllers/customerEstimateController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

// SCRUM-15: customer-only, ownership-checked, public-safe estimate DTO.
router.get(
  '/jobs/:jobIdentifier/current-estimate',
  protect,
  authorizeRoles('customer'),
  customerEstimateController.getCurrentEstimate
);

module.exports = router;
