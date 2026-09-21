require('dotenv').config();
const { verifyEmailTransport } = require('../src/services/emailService');

const run = async () => {
  try {
    await verifyEmailTransport();
    console.log('Gmail SMTP configuration is valid and ready to send OTP emails.');
  } catch (error) {
    console.error('Gmail SMTP verification failed:', error.message);
    process.exitCode = 1;
  }
};

run();
