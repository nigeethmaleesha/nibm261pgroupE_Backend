const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');
const { getAccessTokenFromRequest } = require('../utils/authCookies');

const protect = async (req, res, next) => {
  const token = getAccessTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.tokenType !== 'access' || !decoded.sub || !decoded.sid) {
      return res.status(401).json({ message: 'Invalid access token' });
    }

    const user = await userRepository.findById(decoded.sub, { includeSessions: true });

    if (!user || !user.isActive || !user.isEmailVerified) {
      return res.status(401).json({ message: 'Session is no longer valid' });
    }

    if (decoded.role && decoded.role !== user.role) {
      return res.status(401).json({ message: 'Session role is no longer valid' });
    }

    const activeSession = (user.activeSessions || []).find(
      (session) => session.sessionId === decoded.sid && new Date(session.expiresAt) > new Date()
    );

    if (!activeSession) {
      return res.status(401).json({ message: 'Session has ended. Please log in again.' });
    }

    req.user = user;
    req.auth = {
      userId: decoded.sub,
      role: decoded.role,
      sessionId: decoded.sid
    };

    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        message: 'Access token expired',
        code: 'ACCESS_TOKEN_EXPIRED'
      });
    }

    return res.status(401).json({ message: 'Invalid access token' });
  }
};

const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have permission to access this resource' });
  }
  return next();
};

const ownerStaffOnly = authorizeRoles('owner_staff');
const technicianOnly = authorizeRoles('technician');
const customerOnly = authorizeRoles('customer');

module.exports = {
  protect,
  authorizeRoles,
  ownerStaffOnly,
  technicianOnly,
  customerOnly
};
