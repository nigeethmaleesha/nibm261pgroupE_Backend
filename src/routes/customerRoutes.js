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

// SCRUM-109: Customer public repair tracking view.
// Returns latest saved status, chronological dated public events sanitized
// of internal notes and technician IDs, estimate decision links, delay reasons,
// handover instructions, and collection timestamps/outcomes.
router.get(
  '/jobs/:jobIdentifier/track',
  protect,
  authorizeRoles('customer'),
  customerJobController.getJobTracking
);
router.get(
  '/jobs/:jobIdentifier/tracking',
  protect,
  authorizeRoles('customer'),
  customerJobController.getJobTracking
);

// SCRUM-125: Customer view completed repair records & history
// GET /api/customer/jobs/history
// Returns all completed/Collected repair jobs for the authenticated customer,
// including reference, device, public repair summary or return reason, outcome,
// collection time, and all issued estimate versions with recorded decisions.
router.get(
  '/jobs/history',
  protect,
  authorizeRoles('customer'),
  customerJobController.getCompletedHistory
);
router.get(
  ['/jobs/:jobIdentifier/history', '/jobs/history/:jobIdentifier'],
  protect,
  authorizeRoles('customer'),
  customerJobController.getCompletedJobDetail
);

module.exports = router;

