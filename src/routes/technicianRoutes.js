const express = require('express');
const internalAuthController = require('../controllers/internalAuthController');
const repairJobController = require('../controllers/repairJobController');
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

module.exports = router;
