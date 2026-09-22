const internalAuthService = require('../services/internalAuthService');
const {
  setAuthCookies,
  clearAuthCookies,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest
} = require('../utils/authCookies');

const sendLoginVerification = async (req, res, next, role) => {
  try {
    const result = await internalAuthService.verifyLoginOtp(req.body, role);
    setAuthCookies(res, result);

    return res.status(200).json({
      message: result.message,
      user: result.user,
      tokenStorage: 'httpOnly_cookies',
      accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
      refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'
    });
  } catch (error) {
    return next(error);
  }
};

const createRoleController = (role) => ({
  login: async (req, res, next) => {
    try {
      return res.status(202).json(await internalAuthService.login(req.body, role));
    } catch (error) {
      return next(error);
    }
  },

  verifyLoginOtp: (req, res, next) => sendLoginVerification(req, res, next, role),

  resendLoginOtp: async (req, res, next) => {
    try {
      return res.status(200).json(await internalAuthService.resendLoginOtp(req.body, role));
    } catch (error) {
      return next(error);
    }
  },

  initiateForgotPassword: async (req, res, next) => {
    try {
      return res.status(200).json(await internalAuthService.initiateForgotPassword(req.body, role));
    } catch (error) {
      return next(error);
    }
  },

  resendForgotPasswordOtp: async (req, res, next) => {
    try {
      return res.status(200).json(await internalAuthService.resendForgotPasswordOtp(req.body, role));
    } catch (error) {
      return next(error);
    }
  },

  verifyForgotPasswordOtp: async (req, res, next) => {
    try {
      return res.status(200).json(await internalAuthService.verifyForgotPasswordOtp(req.body, role));
    } catch (error) {
      return next(error);
    }
  },

  changeForgottenPassword: async (req, res, next) => {
    try {
      const result = await internalAuthService.changeForgottenPassword(req.body, role);
      clearAuthCookies(res);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  },

  refreshToken: async (req, res, next) => {
    try {
      const result = await internalAuthService.refreshSession(
        getRefreshTokenFromRequest(req),
        role
      );
      setAuthCookies(res, result);
      return res.status(200).json({
        message: 'Session refreshed successfully',
        user: internalAuthService.sanitizeUser(result.user),
        tokenStorage: 'httpOnly_cookies'
      });
    } catch (error) {
      clearAuthCookies(res);
      return next(error);
    }
  },

  logout: async (req, res, next) => {
    try {
      const result = await internalAuthService.logoutCurrentSession({
        refreshToken: getRefreshTokenFromRequest(req),
        accessToken: getAccessTokenFromRequest(req)
      });
      clearAuthCookies(res);
      return res.status(200).json(result);
    } catch (error) {
      clearAuthCookies(res);
      return next(error);
    }
  },

  me: async (req, res) => res.status(200).json({
    user: internalAuthService.sanitizeUser(req.user)
  })
});

const staffAuth = createRoleController('owner_staff');
const technicianAuth = createRoleController('technician');

const setupOwnerStaff = async (req, res, next) => {
  try {
    return res.status(202).json(await internalAuthService.setupOwnerStaff(req.body));
  } catch (error) {
    return next(error);
  }
};

const verifyOwnerStaffSetupOtp = async (req, res, next) => {
  try {
    return res.status(201).json(await internalAuthService.verifyOwnerStaffSetupOtp(req.body));
  } catch (error) {
    return next(error);
  }
};

const resendOwnerStaffSetupOtp = async (req, res, next) => {
  try {
    return res.status(200).json(await internalAuthService.resendOwnerStaffSetupOtp(req.body));
  } catch (error) {
    return next(error);
  }
};

const verifyTechnicianActivationOtp = async (req, res, next) => {
  try {
    return res.status(201).json(await internalAuthService.verifyTechnicianActivationOtp(req.body));
  } catch (error) {
    return next(error);
  }
};

const resendTechnicianActivationOtp = async (req, res, next) => {
  try {
    return res.status(200).json(await internalAuthService.resendTechnicianActivationOtp(req.body));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  staffAuth,
  technicianAuth,
  setupOwnerStaff,
  verifyOwnerStaffSetupOtp,
  resendOwnerStaffSetupOtp,
  verifyTechnicianActivationOtp,
  resendTechnicianActivationOtp
};
