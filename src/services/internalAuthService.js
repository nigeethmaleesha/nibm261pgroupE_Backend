const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');
const otpService = require('./otpService');
const sessionService = require('./sessionService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RESET_TOKEN_EXPIRES_IN = process.env.PASSWORD_RESET_TOKEN_EXPIRES_IN || '15m';
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

const ROLE_CONFIG = {
  owner_staff: {
    label: 'Owner/Staff',
    registrationPurpose: 'OWNER_STAFF_REGISTER',
    loginPurpose: 'OWNER_STAFF_LOGIN',
    forgotPurpose: 'OWNER_STAFF_FORGOT_PASSWORD'
  },
  technician: {
    label: 'Technician',
    registrationPurpose: 'TECHNICIAN_REGISTER',
    loginPurpose: 'TECHNICIAN_LOGIN',
    forgotPurpose: 'TECHNICIAN_FORGOT_PASSWORD'
  }
};

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getRoleConfig = (role) => {
  const config = ROLE_CONFIG[role];
  if (!config) throw new Error(`Unsupported internal role: ${role}`);
  return config;
};

const sanitizeUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  contactNumber: user.contactNumber,
  role: user.role,
  isActive: user.isActive,
  isEmailVerified: user.isEmailVerified === true,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

const validateAccountPayload = (payload = {}, expectedRole) => {
  const fullName = String(payload.fullName || '').trim();
  const email = normalizeEmail(payload.email);
  const contactNumber = String(payload.contactNumber || payload.phoneNumber || '').trim();
  const password = String(payload.password || '');

  if (!fullName || !email || !contactNumber || !password) {
    throw createHttpError('Full name, email, contact number and password are required', 400);
  }

  if (!EMAIL_REGEX.test(email)) {
    throw createHttpError('Please provide a valid email address', 400);
  }

  if (password.length < 12) {
    throw createHttpError('Password must contain at least 12 characters', 400);
  }

  if (payload.role && String(payload.role).trim().toLowerCase() !== expectedRole) {
    throw createHttpError(`This endpoint can create only ${expectedRole} accounts`, 403);
  }

  return { fullName, email, contactNumber, password };
};

const passwordFingerprint = (passwordHash) => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');

  return crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(String(passwordHash || ''))
    .digest('hex');
};

const signPasswordResetToken = (user) => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  if (!user.password) throw new Error('Password hash is required to create a password reset token');

  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      purpose: 'internal-password-reset',
      passwordFingerprint: passwordFingerprint(user.password),
      jti: crypto.randomUUID()
    },
    process.env.JWT_SECRET,
    { expiresIn: PASSWORD_RESET_TOKEN_EXPIRES_IN }
  );
};

const setupOwnerStaff = async (payload = {}) => {
  const account = validateAccountPayload(payload, 'owner_staff');
  const existingOwner = await userRepository.findByRole('owner_staff');

  // The setup endpoint is intentionally one-time. If the first request created
  // a pending account, use the dedicated resend/verify endpoints instead of
  // submitting another setup request.
  if (existingOwner) {
    throw createHttpError('Owner/Staff account has already been created or setup is already pending', 409);
  }

  const emailOwner = await userRepository.findByEmail(account.email);
  if (emailOwner) {
    throw createHttpError('An account with this email address already exists', 409);
  }

  let owner;
  try {
    owner = await userRepository.createPendingInternalUser({
      ...account,
      role: 'owner_staff'
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw createHttpError('Owner/Staff account already exists or this email is already in use', 409);
    }
    throw error;
  }

  const otpInfo = await otpService.issueOtp(owner, getRoleConfig('owner_staff').registrationPurpose);

  return {
    message: 'Owner/Staff setup OTP sent successfully. Verify the email to activate the account.',
    requiresOtp: true,
    account: sanitizeUser(owner),
    ...otpInfo
  };
};

const verifyOwnerStaffSetupOtp = async (payload = {}) => {
  const email = normalizeEmail(payload.email);
  if (!email) throw createHttpError('Email is required', 400);

  const owner = await userRepository.findByEmail(email);
  if (!owner || owner.role !== 'owner_staff' || owner.isEmailVerified) {
    throw createHttpError('Owner/Staff setup verification is invalid or already completed', 400);
  }

  await otpService.verifyOtp(owner, payload.otp, getRoleConfig('owner_staff').registrationPurpose);
  owner.isEmailVerified = true;
  owner.isActive = true;
  await userRepository.save(owner);

  return {
    message: 'Owner/Staff account verified successfully',
    user: sanitizeUser(owner)
  };
};

const resendOwnerStaffSetupOtp = async (payload = {}) => {
  const email = normalizeEmail(payload.email);
  if (!email) throw createHttpError('Email is required', 400);

  const owner = await userRepository.findByEmail(email);
  if (!owner || owner.role !== 'owner_staff' || owner.isEmailVerified) {
    throw createHttpError('No pending Owner/Staff setup was found for this email', 400);
  }

  const otpInfo = await otpService.resendOtp(owner, getRoleConfig('owner_staff').registrationPurpose);
  return {
    message: 'A new Owner/Staff setup OTP has been sent to the registered email.',
    requiresOtp: true,
    ...otpInfo
  };
};

const verifyTechnicianActivationOtp = async (payload = {}) => {
  const email = normalizeEmail(payload.email);
  if (!email) throw createHttpError('Email is required', 400);

  const technician = await userRepository.findByEmail(email);
  if (!technician || technician.role !== 'technician' || technician.isEmailVerified) {
    throw createHttpError('Technician activation is invalid or already completed', 400);
  }

  await otpService.verifyOtp(
    technician,
    payload.otp,
    getRoleConfig('technician').registrationPurpose
  );

  technician.isEmailVerified = true;
  technician.isActive = true;
  await userRepository.save(technician);

  return {
    message: 'Technician email verified and account activated successfully',
    user: sanitizeUser(technician)
  };
};

const resendTechnicianActivationOtp = async (payload = {}) => {
  const email = normalizeEmail(payload.email);
  if (!email) throw createHttpError('Email is required', 400);

  const technician = await userRepository.findByEmail(email);
  if (!technician || technician.role !== 'technician' || technician.isEmailVerified) {
    throw createHttpError('No pending technician activation was found for this email', 400);
  }

  const otpInfo = await otpService.resendOtp(
    technician,
    getRoleConfig('technician').registrationPurpose
  );

  return {
    message: 'A new technician activation OTP has been sent to the registered email.',
    requiresOtp: true,
    ...otpInfo
  };
};

const login = async (payload = {}, role) => {
  const config = getRoleConfig(role);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');

  if (!email || !password) {
    throw createHttpError('Email and password are required', 400);
  }

  const user = await userRepository.findByEmail(email, { includePassword: true });

  if (!user || user.role !== role || !(await user.comparePassword(password))) {
    throw createHttpError(GENERIC_LOGIN_ERROR, 401);
  }

  if (!user.isActive) {
    throw createHttpError(`${config.label} account is disabled`, 403);
  }

  if (!user.isEmailVerified) {
    throw createHttpError('Please verify the account email before logging in', 403);
  }

  const otpInfo = await otpService.issueOtp(user, config.loginPurpose);
  return {
    message: `${config.label} credentials accepted. A login OTP has been sent to the registered email.`,
    requiresOtp: true,
    ...otpInfo
  };
};

const verifyLoginOtp = async (payload = {}, role) => {
  const config = getRoleConfig(role);
  const email = normalizeEmail(payload.email);
  if (!email) throw createHttpError('Email is required', 400);

  const user = await userRepository.findByEmail(email, { includeSessions: true });
  if (!user || user.role !== role || !user.isEmailVerified || !user.isActive) {
    throw createHttpError('Login verification is no longer valid. Please log in again.', 401);
  }

  await otpService.verifyOtp(user, payload.otp, config.loginPurpose);
  const tokens = await sessionService.createSession(user);

  return {
    message: `${config.label} login OTP verified successfully`,
    user: sanitizeUser(user),
    ...tokens
  };
};

const resendLoginOtp = async (payload = {}, role) => {
  const config = getRoleConfig(role);
  const email = normalizeEmail(payload.email);
  if (!email) throw createHttpError('Email is required', 400);

  const user = await userRepository.findByEmail(email);
  if (!user || user.role !== role || !user.isEmailVerified || !user.isActive) {
    throw createHttpError('No pending login OTP request was found for this email', 400);
  }

  const otpInfo = await otpService.resendOtp(user, config.loginPurpose);
  return {
    message: `A new ${config.label} login OTP has been sent to the registered email.`,
    requiresOtp: true,
    ...otpInfo
  };
};

const initiateForgotPassword = async (payload = {}, role) => {
  const config = getRoleConfig(role);
  const email = normalizeEmail(payload.email);

  if (!email) throw createHttpError('Email is required', 400);
  if (!EMAIL_REGEX.test(email)) throw createHttpError('Please provide a valid email address', 400);

  const genericMessage = 'If a verified active account matches that email, a password reset OTP has been sent.';
  const user = await userRepository.findByEmail(email);

  if (!user || user.role !== role || !user.isEmailVerified || !user.isActive) {
    return { message: genericMessage, requiresOtp: true };
  }

  const otpInfo = await otpService.issueOtp(user, config.forgotPurpose);
  return { message: genericMessage, requiresOtp: true, ...otpInfo };
};

const resendForgotPasswordOtp = async (payload = {}, role) => {
  const config = getRoleConfig(role);
  const email = normalizeEmail(payload.email);

  if (!email) throw createHttpError('Email is required', 400);
  if (!EMAIL_REGEX.test(email)) throw createHttpError('Please provide a valid email address', 400);

  const genericMessage = 'If a password reset request is pending for that email, a new OTP has been sent.';
  const user = await userRepository.findByEmail(email);

  if (!user || user.role !== role || !user.isEmailVerified || !user.isActive) {
    return { message: genericMessage, requiresOtp: true };
  }

  try {
    const otpInfo = await otpService.resendOtp(user, config.forgotPurpose);
    return { message: genericMessage, requiresOtp: true, ...otpInfo };
  } catch (error) {
    if (error.statusCode === 400 && String(error.message || '').startsWith('No pending')) {
      return { message: genericMessage, requiresOtp: true };
    }
    throw error;
  }
};

const verifyForgotPasswordOtp = async (payload = {}, role) => {
  const config = getRoleConfig(role);
  const email = normalizeEmail(payload.email);
  if (!email) throw createHttpError('Email is required', 400);

  const user = await userRepository.findByEmail(email, { includePassword: true });
  if (!user || user.role !== role || !user.isEmailVerified || !user.isActive) {
    throw createHttpError('Invalid or expired password reset request', 400);
  }

  await otpService.verifyOtp(user, payload.otp, config.forgotPurpose);
  return {
    message: 'Password reset OTP verified successfully.',
    resetToken: signPasswordResetToken(user),
    resetTokenExpiresIn: PASSWORD_RESET_TOKEN_EXPIRES_IN
  };
};

const changeForgottenPassword = async (payload = {}, role) => {
  const resetToken = String(payload.resetToken || '').trim();
  const newPassword = String(payload.newPassword || '');
  const confirmPassword = payload.confirmPassword === undefined
    ? newPassword
    : String(payload.confirmPassword || '');

  if (!resetToken) throw createHttpError('Password reset token is required', 401);
  if (newPassword.length < 12) {
    throw createHttpError('New password must contain at least 12 characters', 400);
  }
  if (newPassword !== confirmPassword) {
    throw createHttpError('New password and confirm password do not match', 400);
  }

  let decoded;
  try {
    decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
  } catch (error) {
    throw createHttpError('Invalid or expired password reset token', 401);
  }

  if (
    decoded.purpose !== 'internal-password-reset' ||
    decoded.role !== role ||
    !decoded.sub ||
    !decoded.email ||
    !decoded.passwordFingerprint
  ) {
    throw createHttpError('Invalid password reset token', 401);
  }

  const user = await userRepository.findById(decoded.sub, {
    includePassword: true,
    includeSessions: true
  });

  if (
    !user ||
    user.role !== role ||
    !user.isActive ||
    !user.isEmailVerified ||
    normalizeEmail(user.email) !== normalizeEmail(decoded.email)
  ) {
    throw createHttpError('Invalid password reset token', 401);
  }

  if (passwordFingerprint(user.password) !== decoded.passwordFingerprint) {
    throw createHttpError('This password reset token has already been used or is no longer valid', 401);
  }

  user.password = newPassword;
  user.activeSessions = [];
  await userRepository.save(user);
  await otpService.deleteUserOtps(user._id);

  return {
    message: 'Password changed successfully. All existing sessions were signed out. Please log in again.'
  };
};

const refreshSession = (refreshToken, role) => sessionService.refreshSession(refreshToken, [role]);
const logoutCurrentSession = (tokens) => sessionService.logoutCurrentSession(tokens);

module.exports = {
  ROLE_CONFIG,
  sanitizeUser,
  validateAccountPayload,
  setupOwnerStaff,
  verifyOwnerStaffSetupOtp,
  resendOwnerStaffSetupOtp,
  verifyTechnicianActivationOtp,
  resendTechnicianActivationOtp,
  login,
  verifyLoginOtp,
  resendLoginOtp,
  initiateForgotPassword,
  resendForgotPasswordOtp,
  verifyForgotPasswordOtp,
  changeForgottenPassword,
  refreshSession,
  logoutCurrentSession
};
