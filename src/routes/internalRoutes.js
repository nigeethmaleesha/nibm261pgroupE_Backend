const express = require('express');
const internalAccessController = require('../controllers/internalAccessController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const { loginLimiter, otpLimiter } = require('../middlewares/rateLimitMiddleware');

const router = express.Router();

// Shared Owner/Staff + Technician authentication. The backend resolves the
// account role from the submitted email, so the client never asks the user to
// choose a role during sign-in or password recovery.
router.post('/auth/login', loginLimiter, internalAccessController.login);
router.post('/auth/login/verify-otp', otpLimiter, internalAccessController.verifyLoginOtp);
router.post('/auth/login/resend-otp', otpLimiter, internalAccessController.resendLoginOtp);
router.post('/auth/forgot-password/initiate', otpLimiter, internalAccessController.initiateForgotPassword);
router.post('/auth/forgot-password/resend-otp', otpLimiter, internalAccessController.resendForgotPasswordOtp);
router.post('/auth/forgot-password/verify-otp', otpLimiter, internalAccessController.verifyForgotPasswordOtp);
router.post('/auth/forgot-password/change', loginLimiter, internalAccessController.changeForgottenPassword);
router.post('/auth/refresh-token', internalAccessController.refreshToken);
router.post('/auth/logout', internalAccessController.logout);
router.get(
  '/auth/me',
  protect,
  authorizeRoles('owner_staff', 'technician'),
  internalAccessController.me
);

module.exports = router;
