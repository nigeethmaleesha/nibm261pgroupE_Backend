const express = require('express');
const authController = require('../controllers/authController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const {
  registerLimiter,
  loginLimiter,
  otpLimiter
} = require('../middlewares/rateLimitMiddleware');

const router = express.Router();

// Customer registration + email OTP
router.post('/register', registerLimiter, authController.register);
router.post('/register/verify-otp', otpLimiter, authController.verifyRegistrationOtp);
router.post('/register/resend-otp', otpLimiter, authController.resendRegistrationOtp);

// Customer login + email OTP
router.post('/login', loginLimiter, authController.login);
router.post('/login/verify-otp', otpLimiter, authController.verifyLoginOtp);
router.post('/login/resend-otp', otpLimiter, authController.resendLoginOtp);

// Customer forgot-password + email OTP
router.post('/forgot-password/initiate', otpLimiter, authController.initiateForgotPassword);
router.post('/forgot-password/resend-otp', otpLimiter, authController.resendForgotPasswordOtp);
router.post('/forgot-password/verify-otp', otpLimiter, authController.verifyForgotPasswordOtp);
router.post('/forgot-password/change', loginLimiter, authController.changeForgottenPassword);

// JWT session lifecycle
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);
router.get('/me', protect, authorizeRoles('customer'), authController.me);

module.exports = router;
