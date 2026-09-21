const crypto = require('crypto');
const Otp = require('../models/Otp');
const emailService = require('./emailService');

const getOtpExpiresMinutes = () => Number(process.env.OTP_EXPIRES_MINUTES || 10);
const getResendCooldownSeconds = () => Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
const getMaxAttempts = () => Number(process.env.OTP_MAX_ATTEMPTS || 5);
const getMaxResends = () => Number(process.env.OTP_MAX_RESENDS || 5);

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

const normalizePurpose = (purpose) => {
  const normalized = String(purpose || '').trim().toUpperCase();

  if (!['REGISTER', 'LOGIN', 'FORGOT_PASSWORD'].includes(normalized)) {
    throw new Error(`Unsupported OTP purpose: ${purpose}`);
  }

  return normalized;
};

const getRecord = (user, purpose) => Otp.findOne({
  email: user.email,
  purpose: normalizePurpose(purpose),
  userId: user._id
});

const otpMetadata = (record) => ({
  email: record.email,
  otpPurpose: record.purpose,
  otpExpiresInSeconds: Math.max(
    0,
    Math.floor((new Date(record.expiresAt).getTime() - Date.now()) / 1000)
  ),
  resendAvailableInSeconds: getResendCooldownSeconds()
});

const sendOtpEmail = async ({ user, otp, purpose, expiresMinutes }) => {
  try {
    await emailService.sendOtpEmail({
      email: user.email,
      otp,
      purpose,
      expiresInMinutes: expiresMinutes
    });
  } catch (error) {
    throw createHttpError(
      'Unable to send OTP email. The OTP was generated in the database; check the email configuration and use resend OTP after fixing it.',
      502
    );
  }
};

const issueOtp = async (user, purpose) => {
  const normalizedPurpose = normalizePurpose(purpose);
  const now = new Date();
  const expiresMinutes = getOtpExpiresMinutes();
  const otp = generateOtp();

  const record = await Otp.findOneAndUpdate(
    { email: user.email, purpose: normalizedPurpose },
    {
      userId: user._id,
      email: user.email,
      purpose: normalizedPurpose,
      otp,
      expiresAt: new Date(now.getTime() + expiresMinutes * 60 * 1000),
      attempts: 0,
      resendCount: 0,
      lastSentAt: now
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true
    }
  );

  await sendOtpEmail({ user, otp, purpose: normalizedPurpose, expiresMinutes });
  return otpMetadata(record);
};

const missingOtpMessage = (purpose) => {
  if (purpose === 'REGISTER') {
    return 'No pending registration OTP request was found. Please register again.';
  }

  if (purpose === 'FORGOT_PASSWORD') {
    return 'No pending password reset OTP request was found. Please request a password reset again.';
  }

  return 'No pending login OTP request was found. Please login again.';
};

const resendOtp = async (user, purpose) => {
  const normalizedPurpose = normalizePurpose(purpose);
  const current = await getRecord(user, normalizedPurpose);

  if (!current) {
    throw createHttpError(missingOtpMessage(normalizedPurpose), 400);
  }

  if (Number(current.resendCount || 0) >= getMaxResends()) {
    throw createHttpError('Maximum OTP resend limit reached. Please start the process again.', 429);
  }

  if (current.lastSentAt) {
    const cooldownMs = getResendCooldownSeconds() * 1000;
    const elapsedMs = Date.now() - new Date(current.lastSentAt).getTime();

    if (elapsedMs < cooldownMs) {
      const waitSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
      const error = createHttpError(
        `Please wait ${waitSeconds} second(s) before requesting another OTP.`,
        429
      );
      error.retryAfterSeconds = waitSeconds;
      throw error;
    }
  }

  const now = new Date();
  const expiresMinutes = getOtpExpiresMinutes();
  const otp = generateOtp();

  current.otp = otp;
  current.expiresAt = new Date(now.getTime() + expiresMinutes * 60 * 1000);
  current.attempts = 0;
  current.resendCount = Number(current.resendCount || 0) + 1;
  current.lastSentAt = now;
  await current.save();

  await sendOtpEmail({ user, otp, purpose: normalizedPurpose, expiresMinutes });
  return otpMetadata(current);
};

const verifyOtp = async (user, suppliedOtp, purpose) => {
  const normalizedPurpose = normalizePurpose(purpose);
  const otp = String(suppliedOtp || '').trim();

  if (!/^\d{6}$/.test(otp)) {
    throw createHttpError('A valid 6-digit OTP is required', 400);
  }

  const record = await getRecord(user, normalizedPurpose);

  if (!record) {
    throw createHttpError('Invalid OTP request. Please start the process again.', 400);
  }

  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    await Otp.deleteOne({ _id: record._id });
    throw createHttpError('OTP has expired. Please request a new OTP.', 400);
  }

  if (Number(record.attempts || 0) >= getMaxAttempts()) {
    await Otp.deleteOne({ _id: record._id });
    throw createHttpError('Too many incorrect OTP attempts. Please start the process again.', 429);
  }

  // Plaintext comparison is intentional for this coursework flow so the OTP is
  // visible in MongoDB's separate `otp` collection, as in the reference project.
  if (String(record.otp) !== otp) {
    record.attempts = Number(record.attempts || 0) + 1;
    const remaining = Math.max(0, getMaxAttempts() - record.attempts);

    if (remaining === 0) {
      await Otp.deleteOne({ _id: record._id });
    } else {
      await record.save();
    }

    throw createHttpError(
      remaining > 0
        ? `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect OTP attempts. Please start the process again.',
      remaining > 0 ? 400 : 429
    );
  }

  await Otp.deleteOne({ _id: record._id });
  return true;
};

const deleteUserOtps = (userId) => Otp.deleteMany({ userId });

module.exports = {
  issueOtp,
  resendOtp,
  verifyOtp,
  deleteUserOtps,
  generateOtp
};
