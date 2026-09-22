const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');

const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

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
    role: user.role,
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

const refreshSession = async (incomingRefreshToken, allowedRoles = []) => {
  if (!incomingRefreshToken) {
    throw createHttpError('Refresh token is required', 401);
  }

  let decoded;
  try {
    decoded = jwt.verify(incomingRefreshToken, getRefreshSecret());
  } catch (error) {
    throw createHttpError('Invalid or expired refresh token', 401);
  }

  if (decoded.tokenType !== 'refresh' || !decoded.sub || !decoded.sid) {
    throw createHttpError('Invalid refresh token', 401);
  }

  const user = await userRepository.findById(decoded.sub, { includeSessions: true });
  const roleAllowed = allowedRoles.length === 0 || allowedRoles.includes(user?.role);

  if (!user || !user.isActive || !user.isEmailVerified || !roleAllowed) {
    throw createHttpError('Session is no longer valid', 401);
  }

  pruneExpiredSessions(user);

  const session = user.activeSessions.find((item) => item.sessionId === decoded.sid);
  if (!session || session.refreshTokenHash !== hashRefreshToken(incomingRefreshToken)) {
    await userRepository.save(user);
    throw createHttpError('Session is no longer valid', 401);
  }

  const refreshToken = signRefreshToken(user, session.sessionId);
  const accessToken = signAccessToken(user, session.sessionId);

  session.refreshTokenHash = hashRefreshToken(refreshToken);
  session.expiresAt = getRefreshExpiryDate();
  session.lastRotatedAt = new Date();
  await userRepository.save(user);

  return { accessToken, refreshToken, user };
};

const logoutCurrentSession = async ({ refreshToken, accessToken }) => {
  let userId = null;
  let sessionId = null;

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, getRefreshSecret());
      userId = decoded.sub;
      sessionId = decoded.sid;
    } catch (error) {
      // Logout is intentionally idempotent.
    }
  }

  if ((!userId || !sessionId) && accessToken && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET, { ignoreExpiration: true });
      userId = decoded.sub;
      sessionId = decoded.sid;
    } catch (error) {
      // Ignore invalid access tokens during logout.
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
  createSession,
  refreshSession,
  logoutCurrentSession
};
