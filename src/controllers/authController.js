const authService = require('../services/authService');
const {
  setAuthCookies,
  clearAuthCookies,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest
} = require('../utils/authCookies');

const register = async (req, res, next) => {
  try {
    const result = await authService.registerCustomer(req.body);
    return res.status(202).json(result);
  } catch (error) {
    return next(error);
  }
};

const verifyRegistrationOtp = async (req, res, next) => {
  try {
    const result = await authService.verifyRegistrationOtp(req.body);
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
};

const resendRegistrationOtp = async (req, res, next) => {
  try {
    const result = await authService.resendRegistrationOtp(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const result = await authService.loginCustomer(req.body);
    return res.status(202).json(result);
  } catch (error) {
    return next(error);
  }
};

const verifyLoginOtp = async (req, res, next) => {
  try {
    const result = await authService.verifyLoginOtp(req.body);

    setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken
    });

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

const resendLoginOtp = async (req, res, next) => {
  try {
    const result = await authService.resendLoginOtp(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const initiateForgotPassword = async (req, res, next) => {
  try {
    const result = await authService.initiateForgotPassword(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const resendForgotPasswordOtp = async (req, res, next) => {
  try {
    const result = await authService.resendForgotPasswordOtp(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const verifyForgotPasswordOtp = async (req, res, next) => {
  try {
    const result = await authService.verifyForgotPasswordOtp(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const changeForgottenPassword = async (req, res, next) => {
  try {
    const result = await authService.changeForgottenPassword(req.body);

    // If this browser happened to have an older customer session, clear its
    // cookies because a successful password reset revokes every active session.
    clearAuthCookies(res);

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const result = await authService.refreshSession(getRefreshTokenFromRequest(req));

    setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken
    });

    return res.status(200).json({
      message: result.message,
      user: result.user,
      tokenStorage: 'httpOnly_cookies'
    });
  } catch (error) {
    clearAuthCookies(res);
    return next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const result = await authService.logoutCurrentSession({
      refreshToken: getRefreshTokenFromRequest(req),
      accessToken: getAccessTokenFromRequest(req)
    });

    clearAuthCookies(res);
    return res.status(200).json(result);
  } catch (error) {
    clearAuthCookies(res);
    return next(error);
  }
};

const me = async (req, res) => res.status(200).json({
  user: authService.sanitizeUser(req.user)
});

module.exports = {
  register,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  login,
  verifyLoginOtp,
  resendLoginOtp,
  initiateForgotPassword,
  resendForgotPasswordOtp,
  verifyForgotPasswordOtp,
  changeForgottenPassword,
  refreshToken,
  logout,
  me
};
