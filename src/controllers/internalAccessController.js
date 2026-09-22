const internalAuthService = require('../services/internalAuthService');
const {
  setAuthCookies,
  clearAuthCookies,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest
} = require('../utils/authCookies');

const login = async (req, res, next) => {
  try {
    return res.status(202).json(await internalAuthService.loginInternalByEmail(req.body));
  } catch (error) {
    return next(error);
  }
};

const verifyLoginOtp = async (req, res, next) => {
  try {
    const result = await internalAuthService.verifyInternalLoginOtpByEmail(req.body);
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

const resendLoginOtp = async (req, res, next) => {
  try {
    return res.status(200).json(await internalAuthService.resendInternalLoginOtpByEmail(req.body));
  } catch (error) {
    return next(error);
  }
};

const initiateForgotPassword = async (req, res, next) => {
  try {
    return res.status(200).json(await internalAuthService.initiateInternalForgotPasswordByEmail(req.body));
  } catch (error) {
    return next(error);
  }
};

const resendForgotPasswordOtp = async (req, res, next) => {
  try {
    return res.status(200).json(await internalAuthService.resendInternalForgotPasswordOtpByEmail(req.body));
  } catch (error) {
    return next(error);
  }
};

const verifyForgotPasswordOtp = async (req, res, next) => {
  try {
    return res.status(200).json(await internalAuthService.verifyInternalForgotPasswordOtpByEmail(req.body));
  } catch (error) {
    return next(error);
  }
};

const changeForgottenPassword = async (req, res, next) => {
  try {
    const result = await internalAuthService.changeInternalForgottenPasswordByToken(req.body);
    clearAuthCookies(res);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const result = await internalAuthService.refreshInternalSession(
      getRefreshTokenFromRequest(req)
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
};

const logout = async (req, res, next) => {
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
};

const me = async (req, res) => res.status(200).json({
  user: internalAuthService.sanitizeUser(req.user)
});

module.exports = {
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
