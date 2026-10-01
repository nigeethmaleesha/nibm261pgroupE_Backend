const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

const createMoneyError = (message) => {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
};

const parseLkrToMinor = (value, fieldName = 'Unit price') => {
  if (value === undefined || value === null || value === '') {
    throw createMoneyError(`${fieldName} is required`);
  }

  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  const match = raw.match(/^(\d+)(?:\.(\d{1,2}))?$/);

  if (!match) {
    throw createMoneyError(`${fieldName} must be non-negative with at most two decimal places`);
  }

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] || '').padEnd(2, '0'));
  const minor = (whole * 100n) + fractional;

  if (minor > MAX_SAFE_MINOR) {
    throw createMoneyError(`${fieldName} is too large`);
  }

  return Number(minor);
};

const multiplyMinor = (quantity, unitPriceMinor) => {
  const total = BigInt(quantity) * BigInt(unitPriceMinor);
  if (total > MAX_SAFE_MINOR) {
    throw createMoneyError('Line total is too large');
  }
  return Number(total);
};

const sumMinor = (values) => {
  let total = 0n;
  for (const value of values) {
    total += BigInt(value);
    if (total > MAX_SAFE_MINOR) {
      throw createMoneyError('Estimate total is too large');
    }
  }
  return Number(total);
};

const formatMinor = (minor) => (Number(minor) / 100).toFixed(2);

module.exports = {
  parseLkrToMinor,
  multiplyMinor,
  sumMinor,
  formatMinor
};
