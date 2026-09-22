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

  const content = {
    REGISTER: {
      title: 'Customer Registration Verification',
      actionLabel: 'customer registration',
      subject: 'RepairFlow - Customer Registration OTP'
    },
    LOGIN: {
      title: 'Customer Login Verification',
      actionLabel: 'customer login',
      subject: 'RepairFlow - Customer Login OTP'
    },
    FORGOT_PASSWORD: {
      title: 'Customer Password Reset Verification',
      actionLabel: 'customer password reset',
      subject: 'RepairFlow - Customer Password Reset OTP'
    },
    OWNER_STAFF_REGISTER: {
      title: 'Owner/Staff Setup Verification',
      actionLabel: 'Owner/Staff account setup',
      subject: 'RepairFlow - Owner/Staff Setup OTP'
    },
    OWNER_STAFF_LOGIN: {
      title: 'Owner/Staff Login Verification',
      actionLabel: 'Owner/Staff login',
      subject: 'RepairFlow - Owner/Staff Login OTP'
    },
    OWNER_STAFF_FORGOT_PASSWORD: {
      title: 'Owner/Staff Password Reset Verification',
      actionLabel: 'Owner/Staff password reset',
      subject: 'RepairFlow - Owner/Staff Password Reset OTP'
    },
    TECHNICIAN_REGISTER: {
      title: 'Technician Account Verification',
      actionLabel: 'technician account activation',
      subject: 'RepairFlow - Technician Activation OTP'
    },
    TECHNICIAN_LOGIN: {
      title: 'Technician Login Verification',
      actionLabel: 'technician login',
      subject: 'RepairFlow - Technician Login OTP'
    },
    TECHNICIAN_FORGOT_PASSWORD: {
      title: 'Technician Password Reset Verification',
      actionLabel: 'technician password reset',
      subject: 'RepairFlow - Technician Password Reset OTP'
    }
  }[normalizedPurpose];

  if (!content) {
    throw new Error(`Unsupported email OTP purpose: ${purpose}`);
  }

  return content;
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
