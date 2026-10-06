const express = require('express');
const internalAuthController = require('../controllers/internalAuthController');
const repairJobController = require('../controllers/repairJobController');
const diagnosisController = require('../controllers/diagnosisController');
const repairProgressController = require('../controllers/repairProgressController');
const jobProgressLogController = require('../controllers/jobProgressLogController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const { loginLimiter, otpLimiter } = require('../middlewares/rateLimitMiddleware');

const router = express.Router();
const technicianAuth = internalAuthController.technicianAuth;

// Activation after Owner/Staff creates a technician account.
router.post('/auth/activate/verify-otp', otpLimiter, internalAuthController.verifyTechnicianActivationOtp);
router.post('/auth/activate/resend-otp', otpLimiter, internalAuthController.resendTechnicianActivationOtp);

// Technician authentication lifecycle.
router.post('/auth/login', loginLimiter, technicianAuth.login);
router.post('/auth/login/verify-otp', otpLimiter, technicianAuth.verifyLoginOtp);
router.post('/auth/login/resend-otp', otpLimiter, technicianAuth.resendLoginOtp);
router.post('/auth/forgot-password/initiate', otpLimiter, technicianAuth.initiateForgotPassword);
router.post('/auth/forgot-password/resend-otp', otpLimiter, technicianAuth.resendForgotPasswordOtp);
router.post('/auth/forgot-password/verify-otp', otpLimiter, technicianAuth.verifyForgotPasswordOtp);
router.post('/auth/forgot-password/change', loginLimiter, technicianAuth.changeForgottenPassword);
router.post('/auth/refresh-token', technicianAuth.refreshToken);
router.post('/auth/logout', technicianAuth.logout);
router.get('/auth/me', protect, authorizeRoles('technician'), technicianAuth.me);

// SCRUM-41: technician views their own assigned repair jobs.
router.get(
  '/jobs',
  protect,
  authorizeRoles('technician'),
  repairJobController.listMyJobs
);
router.get(
  '/jobs/:jobIdentifier',
  protect,
  authorizeRoles('technician'),
  repairJobController.getMyJob
);

// SCRUM-13: assigned technician diagnosis workflow.
router.get(
  '/jobs/:jobIdentifier/diagnosis',
  protect,
  authorizeRoles('technician'),
  diagnosisController.getTechnicianDiagnosis
);
router.post(
  '/jobs/:jobIdentifier/diagnosis/start',
  protect,
  authorizeRoles('technician'),
  diagnosisController.startDiagnosis
);
router.patch(
  '/jobs/:jobIdentifier/diagnosis',
  protect,
  authorizeRoles('technician'),
  diagnosisController.saveDiagnosis
);

// Repair progress: assigned technician updates status/notes. Locked with
// 409 REPAIR_LOCKED while the job is Awaiting Approval.
router.get(
  '/jobs/:jobIdentifier/progress',
  protect,
  authorizeRoles('technician'),
  repairProgressController.getProgressHistory
);
router.patch(
  '/jobs/:jobIdentifier/progress',
  protect,
  authorizeRoles('technician'),
  repairProgressController.updateProgress
);

// Start or resume repair: assigned technician only. Allowed from Approved, or
// from Waiting for Parts once the parts hold is resolved, and only when the
// latest estimate version is approved. Rechecked atomically when saving.
router.post(
  '/jobs/:jobIdentifier/start-repair',
  protect,
  authorizeRoles('technician'),
  repairProgressController.startRepair
);

// SCRUM-22 Parts Delay Management. Only the assigned technician can place a
// hold. Both commands use POST because they are explicit workflow actions.
router.post(
  '/jobs/:jobIdentifier/parts-hold',
  protect,
  authorizeRoles('technician'),
  repairProgressController.placePartsHold
);
router.post(
  '/jobs/:jobIdentifier/resolve-parts-hold',
  protect,
  authorizeRoles('technician'),
  repairProgressController.resolvePartsHold
);

// Backward-compatible alias used by the previous frontend build.
router.patch(
  '/jobs/:jobIdentifier/parts-hold/resolve',
  protect,
  authorizeRoles('technician'),
  repairProgressController.resolvePartsHold
);

// SCRUM-25 / SCRUM-112: Assigned technician completes repair with Quality Control checks.
// Also supports :id for Jira specification alias POST /api/technician/jobs/:id/complete.
router.post(
  ['/jobs/:jobIdentifier/complete', '/jobs/:id/complete'],
  protect,
  authorizeRoles('technician'),
  repairProgressController.completeRepair
);

// Progress updates while In Repair (job_progress_logs): internal work note
// (is_public: false) + customer-safe update (is_public: true). Both texts are
// required. POST needs an Idempotency-Key header; a retry replays the entry.
// /work-notes is kept as an alias of /progress-updates.
router.get(
  ['/jobs/:jobIdentifier/progress-updates', '/jobs/:jobIdentifier/work-notes'],
  protect,
  authorizeRoles('technician'),
  jobProgressLogController.listProgressUpdates
);
router.post(
  ['/jobs/:jobIdentifier/progress-updates', '/jobs/:jobIdentifier/work-notes'],
  protect,
  authorizeRoles('technician'),
  jobProgressLogController.recordProgressUpdate
);

module.exports = router;
