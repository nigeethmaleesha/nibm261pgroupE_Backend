const express = require('express');
const customerEstimateController = require('../controllers/customerEstimateController');
const customerJobController = require('../controllers/customerJobController');
const diagnosisController = require('../controllers/diagnosisController');
const jobProgressLogController = require('../controllers/jobProgressLogController');
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

// SCRUM-13: public-safe diagnosis summary. The service uses an allow-list
// serializer so internalNotes/findings/recommendations never reach customers.
router.get(
  '/jobs/:jobIdentifier/diagnosis',
  protect,
  authorizeRoles('customer'),
  diagnosisController.getCustomerDiagnosis
);

// SCRUM-15: customer-only, ownership-checked, public-safe estimate DTO.
router.get(
  '/jobs/:jobIdentifier/current-estimate',
  protect,
  authorizeRoles('customer'),
  customerEstimateController.getCurrentEstimate
);

// Customer-safe repair progress updates: only job_progress_logs rows with
// is_public: true are read, through an allow-listed DTO.
router.get(
  '/jobs/:jobIdentifier/progress-updates',
  protect,
  authorizeRoles('customer'),
  jobProgressLogController.listCustomerProgressUpdates
);

module.exports = router;

