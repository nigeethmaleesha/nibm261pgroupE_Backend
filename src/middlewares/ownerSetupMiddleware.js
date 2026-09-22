const crypto = require('crypto');

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const requireOwnerSetupKey = (req, res, next) => {
  const configuredKey = process.env.OWNER_SETUP_KEY;
  if (!configuredKey) {
    return res.status(500).json({ message: 'OWNER_SETUP_KEY is not configured' });
  }

  const providedKey = req.headers['x-owner-setup-key'];
  if (!providedKey || !safeEqual(providedKey, configuredKey)) {
    return res.status(403).json({ message: 'Invalid owner setup key' });
  }

  return next();
};

module.exports = { requireOwnerSetupKey };
