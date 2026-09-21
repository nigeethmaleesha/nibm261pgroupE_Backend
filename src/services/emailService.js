const nodemailer = require('nodemailer');

let transporter;

const getEmailPassword = () => String(process.env.EMAIL_PASS || '').replace(/\s+/g, '');

const assertEmailConfig = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    const error = new Error('Email service is not configured. Set EMAIL_USER and EMAIL_PASS.');
    error.statusCode = 500;
    throw error;
  }
};

const getTransporter = () => {
  assertEmailConfig();

  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: getEmailPassword()
      }
    });
  }

  return transporter;
};

const getOtpEmailContent = (purpose) => {
  const normalizedPurpose = String(purpose || '').trim().toUpperCase();

  if (normalizedPurpose === 'REGISTER') {
    return {
      title: 'Registration Verification',
      actionLabel: 'registration',
      subject: 'RepairFlow - Registration OTP'
    };
  }

  if (normalizedPurpose === 'LOGIN') {
    return {
      title: 'Login Verification',
      actionLabel: 'login',
      subject: 'RepairFlow - Login OTP'
    };
  }

  if (normalizedPurpose === 'FORGOT_PASSWORD') {
    return {
      title: 'Password Reset Verification',
      actionLabel: 'password reset',
      subject: 'RepairFlow - Password Reset OTP'
    };
  }

  throw new Error(`Unsupported email OTP purpose: ${purpose}`);
};

const sendOtpEmail = async ({ email, otp, purpose, expiresInMinutes }) => {
  const { title, actionLabel, subject } = getOtpEmailContent(purpose);
  const fromName = process.env.EMAIL_FROM_NAME || 'RepairFlow';
  const minuteLabel = Number(expiresInMinutes) === 1 ? 'minute' : 'minutes';

  const text = [
    `Your RepairFlow ${actionLabel} verification code is ${otp}.`,
    `This code expires in ${expiresInMinutes} ${minuteLabel}.`,
    'Do not share this code with anyone.',
    'If you did not request this code, you can ignore this email.'
  ].join('\n\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:560px;margin:auto">
      <h2 style="margin-bottom:8px">RepairFlow ${title}</h2>
      <p>Use the following one-time password to continue your ${actionLabel}:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0">${otp}</div>
      <p>This code expires in <strong>${expiresInMinutes} ${minuteLabel}</strong>.</p>
      <p>Do not share this code with anyone.</p>
      <p style="color:#6b7280">If you did not request this code, you can ignore this email.</p>
    </div>
  `;

  await getTransporter().sendMail({
    from: `"${fromName}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject,
    text,
    html
  });
};

const verifyEmailTransport = async () => {
  await getTransporter().verify();
  return true;
};

module.exports = {
  sendOtpEmail,
  assertEmailConfig,
  verifyEmailTransport
};
