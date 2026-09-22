const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randomCode = (length = 4) => {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return value;
};

const generateJobReference = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `JOB-${year}${month}-${randomCode(4)}`;
};

module.exports = {
  generateJobReference
};
