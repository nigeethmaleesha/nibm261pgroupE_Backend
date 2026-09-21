const DEFAULT_ACCESS_COOKIE = 'repairflow_access_token';
const DEFAULT_REFRESH_COOKIE = 'repairflow_refresh_token';

const getAccessCookieName = () => process.env.AUTH_ACCESS_COOKIE_NAME || DEFAULT_ACCESS_COOKIE;
const getRefreshCookieName = () => process.env.AUTH_REFRESH_COOKIE_NAME || DEFAULT_REFRESH_COOKIE;

const isSecureCookie = () => {
  if (process.env.AUTH_COOKIE_SECURE !== undefined) {
    return process.env.AUTH_COOKIE_SECURE === 'true';
  }

  return process.env.NODE_ENV === 'production';
};

const baseCookieOptions = () => ({
  httpOnly: true,
  secure: isSecureCookie(),
  sameSite: process.env.AUTH_COOKIE_SAME_SITE || (isSecureCookie() ? 'none' : 'lax'),
  path: '/'
});

const accessCookieMaxAge = () => {
  const minutes = Number(process.env.ACCESS_TOKEN_COOKIE_MAX_AGE_MINUTES || 15);
  return minutes * 60 * 1000;
};

const refreshCookieMaxAge = () => {
  const days = Number(process.env.REFRESH_TOKEN_COOKIE_MAX_AGE_DAYS || 7);
  return days * 24 * 60 * 60 * 1000;
};

const setAuthCookies = (res, { accessToken, refreshToken }) => {
  res.cookie(getAccessCookieName(), accessToken, {
    ...baseCookieOptions(),
    maxAge: accessCookieMaxAge()
  });

  res.cookie(getRefreshCookieName(), refreshToken, {
    ...baseCookieOptions(),
    maxAge: refreshCookieMaxAge()
  });
};

const clearAuthCookies = (res) => {
  res.clearCookie(getAccessCookieName(), baseCookieOptions());
  res.clearCookie(getRefreshCookieName(), baseCookieOptions());
};

const parseCookies = (cookieHeader = '') => cookieHeader
  .split(';')
  .map((part) => part.trim())
  .filter(Boolean)
  .reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;

    const key = decodeURIComponent(part.slice(0, index).trim());
    const value = decodeURIComponent(part.slice(index + 1).trim());
    cookies[key] = value;
    return cookies;
  }, {});

const getAccessTokenFromRequest = (req) => {
  const authorization = req.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }

  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[getAccessCookieName()] || null;
};

const getRefreshTokenFromRequest = (req) => {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[getRefreshCookieName()] || null;
};

module.exports = {
  setAuthCookies,
  clearAuthCookies,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest
};
