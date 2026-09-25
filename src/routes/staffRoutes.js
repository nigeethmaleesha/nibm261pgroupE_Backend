const express = require('express');
const internalAuthController = require('../controllers/internalAuthController');
const technicianManagementController = require('../controllers/technicianManagementController');
const repairJobController = require('../controllers/repairJobController');
const estimateController = require('../controllers/estimateController');
const estimateRevisionController = require('../controllers/estimateRevisionController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const { requireOwnerSetupKey } = require('../middlewares/ownerSetupMiddleware');
const { registerLimiter, loginLimiter, otpLimiter } = require('../middlewares/rateLimitMiddleware');

const router = express.Router();
const staffAuth = internalAuthController.staffAuth;

// One-time Owner/Staff system setup. The initial create request is protected by
// x-owner-setup-key so a public user cannot claim the privileged role.
router.post('/auth/setup', registerLimiter, requireOwnerSetupKey, internalAuthController.setupOwnerStaff);
router.post('/auth/setup/verify-otp', otpLimiter, internalAuthController.verifyOwnerStaffSetupOtp);
router.post('/auth/setup/resend-otp', otpLimiter, internalAuthController.resendOwnerStaffSetupOtp);

// Owner/Staff authentication lifecycle.
router.post('/auth/login', loginLimiter, staffAuth.login);
router.post('/auth/login/verify-otp', otpLimiter, staffAuth.verifyLoginOtp);
router.post('/auth/login/resend-otp', otpLimiter, staffAuth.resendLoginOtp);
router.post('/auth/forgot-password/initiate', otpLimiter, staffAuth.initiateForgotPassword);
router.post('/auth/forgot-password/resend-otp', otpLimiter, staffAuth.resendForgotPasswordOtp);
router.post('/auth/forgot-password/verify-otp', otpLimiter, staffAuth.verifyForgotPasswordOtp);
router.post('/auth/forgot-password/change', loginLimiter, staffAuth.changeForgottenPassword);
router.post('/auth/refresh-token', staffAuth.refreshToken);
router.post('/auth/logout', staffAuth.logout);
router.get('/auth/me', protect, authorizeRoles('owner_staff'), staffAuth.me);


// SCRUM-9: repair intake support. Owner/Staff selects an existing registered
// customer, then creates one Received repair job using an idempotency key.
router.get(
  '/customers',
  protect,
  authorizeRoles('owner_staff'),
  repairJobController.lookupCustomers
);
router.post(
  '/jobs',
  protect,
  authorizeRoles('owner_staff'),
  repairJobController.createRepairJob
);

// SCRUM-14: Owner/Staff can inspect estimate prerequisites and issue the
// immutable initial version. `jobIdentifier` accepts either MongoDB _id or the
// human-readable job reference so this story is testable before SCRUM-10 UI is merged.
router.get(
  '/jobs/:jobIdentifier/estimate-context',
  protect,
  authorizeRoles('owner_staff'),
  estimateController.getEstimateContext
);
router.post(
  '/jobs/:jobIdentifier/estimates',
  protect,
  authorizeRoles('owner_staff'),
  estimateController.issueInitialEstimate
);

// Estimate revision: full version history, a single per-job draft that never
// replaces the current estimate, and issuing a new sequential version.
router.get(
  '/jobs/:jobIdentifier/estimates',
  protect,
  authorizeRoles('owner_staff'),
  estimateRevisionController.getEstimateHistory
);
router.get(
  '/jobs/:jobIdentifier/estimate-revisions/draft',
  protect,
  authorizeRoles('owner_staff'),
  estimateRevisionController.getRevisionDraft
);
router.put(
  '/jobs/:jobIdentifier/estimate-revisions/draft',
  protect,
  authorizeRoles('owner_staff'),
  estimateRevisionController.saveRevisionDraft
);
router.delete(
  '/jobs/:jobIdentifier/estimate-revisions/draft',
  protect,
  authorizeRoles('owner_staff'),
  estimateRevisionController.discardRevisionDraft
);
router.post(
  '/jobs/:jobIdentifier/estimate-revisions',
  protect,
  authorizeRoles('owner_staff'),
  estimateRevisionController.issueRevisedEstimate
);

// SCRUM-44 / SCRUM-45: technician management is Owner/Staff only.

router.post(
  '/technicians/verify-otp',
  protect,
  authorizeRoles('owner_staff'),
  otpLimiter,
  technicianManagementController.verifyTechnicianOtp
);
router.post(
  '/technicians/resend-otp',
  protect,
  authorizeRoles('owner_staff'),
  otpLimiter,
  technicianManagementController.resendTechnicianOtp
);
router.post(
  '/technicians',
  protect,
  authorizeRoles('owner_staff'),
  registerLimiter,
  technicianManagementController.createTechnician
);
router.get(
  '/technicians',
  protect,
  authorizeRoles('owner_staff'),
  technicianManagementController.listTechnicians
);
router.patch(
  '/technicians/:technicianId/toggle-active',
  protect,
  authorizeRoles('owner_staff'),
  technicianManagementController.toggleTechnicianActive
);

module.exports = router;
