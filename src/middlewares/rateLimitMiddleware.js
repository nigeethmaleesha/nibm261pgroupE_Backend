const { rateLimit } = require('express-rate-limit');

const registerLimiter = rateLimit({
  windowMs: Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.REGISTER_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many registration attempts. Please try again later.' }
});

const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again later.' }
});

const otpLimiter = rateLimit({
  windowMs: Number(process.env.OTP_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.OTP_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many OTP attempts. Please try again later.' }
});

module.exports = {
  registerLimiter,
  loginLimiter,
  otpLimiter
};
