const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');
const otpService = require('./otpService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getRefreshSecret = () => {
  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new Error('REFRESH_TOKEN_SECRET is not configured');
  }
  return process.env.REFRESH_TOKEN_SECRET;
};

const getRefreshExpiryDate = () => {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 7);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

const hashRefreshToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

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

const signAccessToken = (user, sessionId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      sid: sessionId,
      tokenType: 'access'
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
};

const signRefreshToken = (user, sessionId) => jwt.sign(
  {
    sub: user._id.toString(),
    sid: sessionId,
    tokenType: 'refresh',
    jti: crypto.randomUUID()
  },
  getRefreshSecret(),
  { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
);

const pruneExpiredSessions = (user) => {
  const now = Date.now();
  user.activeSessions = (user.activeSessions || []).filter(
    (session) => session.expiresAt && new Date(session.expiresAt).getTime() > now
  );
};

const createSession = async (user) => {
  pruneExpiredSessions(user);

  const sessionId = crypto.randomUUID();
  const refreshToken = signRefreshToken(user, sessionId);
  const accessToken = signAccessToken(user, sessionId);

  user.activeSessions.push({
    sessionId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    createdAt: new Date(),
    expiresAt: getRefreshExpiryDate(),
    lastRotatedAt: new Date()
  });

  await userRepository.save(user);

  return { accessToken, refreshToken };
};

const validateRegistrationPayload = (payload = {}) => {
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

  if (payload.role && String(payload.role).toLowerCase() !== 'customer') {
    throw createHttpError('Customer registration cannot create a privileged account', 403);
  }

  return { fullName, email, contactNumber, password };
};

// Registration step 1:
// Create/update an UNVERIFIED customer in the users collection, then create
// the OTP in the separate `otp` collection and email the same code.
const registerCustomer = async (payload = {}) => {
  const { fullName, email, contactNumber, password } = validateRegistrationPayload(payload);

  let user = await userRepository.findByEmail(email);

  if (user && user.isEmailVerified) {
    throw createHttpError('An account with this email address already exists', 409);
  }

  try {
    if (user) {
      // The same email may re-submit registration while still unverified.
      user.fullName = fullName;
      user.contactNumber = contactNumber;
      user.password = password;
      user.role = 'customer';
      user.isActive = true;
      user.isEmailVerified = false;
      await userRepository.save(user);
    } else {
      user = await userRepository.createPendingCustomer({
        fullName,
        email,
        contactNumber,
        password
      });
    }
  } catch (error) {
    if (error && error.code === 11000) {
      throw createHttpError('An account with this email address already exists', 409);
    }
    throw error;
  }

  const otpInfo = await otpService.issueOtp(user, 'REGISTER');

  return {
    message: 'Registration OTP sent successfully. Verify the OTP to activate the customer account.',
    requiresOtp: true,
    ...otpInfo
  };
};

// Registration step 2:
// Verify email + OTP against the separate Otp model/collection.
const verifyRegistrationOtp = async (payload = {}) => {
  const email = normalizeEmail(payload.email);

  if (!email) {
    throw createHttpError('Email is required', 400);
  }

  const user = await userRepository.findByEmail(email);

  if (!user || user.role !== 'customer' || user.isEmailVerified) {
    throw createHttpError('Registration verification is invalid or already completed', 400);
  }

  await otpService.verifyOtp(user, payload.otp, 'REGISTER');

  user.isEmailVerified = true;
  await userRepository.save(user);

  return {
    message: 'Customer registered and email verified successfully',
    user: sanitizeUser(user)
  };
};

const resendRegistrationOtp = async (payload = {}) => {
  const email = normalizeEmail(payload.email);

  if (!email) {
    throw createHttpError('Email is required', 400);
  }

  const user = await userRepository.findByEmail(email);

  if (!user || user.role !== 'customer' || user.isEmailVerified) {
    throw createHttpError('No pending customer registration was found for this email', 400);
  }

  const otpInfo = await otpService.resendOtp(user, 'REGISTER');

  return {
    message: 'A new registration OTP has been sent to your email.',
    requiresOtp: true,
    ...otpInfo
  };
};

// Login step 1:
// Validate credentials, then create a LOGIN OTP in the separate Otp collection.
const loginCustomer = async (payload = {}) => {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');

  if (!email || !password) {
    throw createHttpError('Email and password are required', 400);
  }

  const user = await userRepository.findByEmail(email, { includePassword: true });

  if (!user || user.role !== 'customer' || !(await user.comparePassword(password))) {
    throw createHttpError(GENERIC_LOGIN_ERROR, 401);
  }

  if (!user.isActive) {
    throw createHttpError('This account is disabled', 403);
  }

  if (!user.isEmailVerified) {
    throw createHttpError('Please verify your registration OTP before logging in', 403);
  }

  const otpInfo = await otpService.issueOtp(user, 'LOGIN');

  return {
    message: 'Login credentials accepted. An OTP has been sent to your email.',
    requiresOtp: true,
    ...otpInfo
  };
};

// Login step 2:
// Only after the login OTP succeeds are access/refresh tokens issued.
const verifyLoginOtp = async (payload = {}) => {
  const email = normalizeEmail(payload.email);

  if (!email) {
    throw createHttpError('Email is required', 400);
  }

  const user = await userRepository.findByEmail(email, { includeSessions: true });

  if (!user || user.role !== 'customer' || !user.isEmailVerified || !user.isActive) {
    throw createHttpError('Login verification is no longer valid. Please log in again.', 401);
  }

  await otpService.verifyOtp(user, payload.otp, 'LOGIN');
  const tokens = await createSession(user);

  return {
    message: 'Login OTP verified successfully',
    user: sanitizeUser(user),
    ...tokens
  };
};

const resendLoginOtp = async (payload = {}) => {
  const email = normalizeEmail(payload.email);

  if (!email) {
    throw createHttpError('Email is required', 400);
  }

  const user = await userRepository.findByEmail(email);

  if (!user || user.role !== 'customer' || !user.isEmailVerified || !user.isActive) {
    throw createHttpError('No pending login OTP request was found for this email', 400);
  }

  const otpInfo = await otpService.resendOtp(user, 'LOGIN');

  return {
    message: 'A new login OTP has been sent to your email.',
    requiresOtp: true,
    ...otpInfo
  };
};

const refreshSession = async (incomingRefreshToken) => {
  if (!incomingRefreshToken) {
    throw createHttpError('Refresh token is required', 401);
  }

  let decoded;
  try {
    decoded = jwt.verify(incomingRefreshToken, getRefreshSecret());
  } catch (verificationError) {
    throw createHttpError('Invalid or expired refresh token', 401);
  }

  if (decoded.tokenType !== 'refresh' || !decoded.sub || !decoded.sid) {
    throw createHttpError('Invalid refresh token', 401);
  }

  const user = await userRepository.findById(decoded.sub, { includeSessions: true });
  if (!user || !user.isActive || user.role !== 'customer') {
    throw createHttpError('Session is no longer valid', 401);
  }

  pruneExpiredSessions(user);

  const session = user.activeSessions.find((item) => item.sessionId === decoded.sid);
  if (!session || session.refreshTokenHash !== hashRefreshToken(incomingRefreshToken)) {
    await userRepository.save(user);
    throw createHttpError('Session is no longer valid', 401);
  }

  const newRefreshToken = signRefreshToken(user, session.sessionId);
  const newAccessToken = signAccessToken(user, session.sessionId);

  session.refreshTokenHash = hashRefreshToken(newRefreshToken);
  session.expiresAt = getRefreshExpiryDate();
  session.lastRotatedAt = new Date();
  await userRepository.save(user);

  return {
    message: 'Session refreshed successfully',
    user: sanitizeUser(user),
    accessToken: newAccessToken,
    refreshToken: newRefreshToken
  };
};

const logoutCurrentSession = async ({ refreshToken, accessToken }) => {
  let userId = null;
  let sessionId = null;

  if (refreshToken) {
    try {
      const decodedRefresh = jwt.verify(refreshToken, getRefreshSecret());
      userId = decodedRefresh.sub;
      sessionId = decodedRefresh.sid;
    } catch (error) {
      // Logout stays idempotent even when the token is expired/invalid.
    }
  }

  if ((!userId || !sessionId) && accessToken && process.env.JWT_SECRET) {
    try {
      const decodedAccess = jwt.verify(accessToken, process.env.JWT_SECRET, {
        ignoreExpiration: true
      });
      userId = decodedAccess.sub;
      sessionId = decodedAccess.sid;
    } catch (error) {
      // Ignore invalid access token during logout.
    }
  }

  if (userId && sessionId) {
    const user = await userRepository.findById(userId, { includeSessions: true });
    if (user) {
      user.activeSessions = (user.activeSessions || []).filter(
        (session) => session.sessionId !== sessionId
      );
      await userRepository.save(user);
    }
  }

  return { message: 'Logged out successfully' };
};

module.exports = {
  registerCustomer,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  loginCustomer,
  verifyLoginOtp,
  resendLoginOtp,
  refreshSession,
  logoutCurrentSession,
  sanitizeUser
};
