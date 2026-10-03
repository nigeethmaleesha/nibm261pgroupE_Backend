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

const sendRepairCompletedEmail = async ({ email, customerName, reference, deviceModel, summary }) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[Notification Trigger] Device ready for collection email simulated for ${email} (Job: ${reference})`);
    return false;
  }
  const fromName = process.env.EMAIL_FROM_NAME || 'RepairFlow';
  const subject = `RepairFlow - Your Device is Ready for Collection! (Ref: ${reference})`;
  const text = [
    `Dear ${customerName || 'Customer'},`,
    `Great news! The repair work on your ${deviceModel} (Reference: ${reference}) has been successfully completed and passed quality control checks.`,
    `Technician Update: ${summary}`,
    'Your device is now Ready for Collection at our service centre. Please bring your reference code and a valid photo ID.',
    'Thank you for choosing RepairFlow!'
  ].join('\n\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:560px;margin:auto">
      <h2 style="color:#059669;margin-bottom:8px">Your Device is Ready for Collection!</h2>
      <p>Dear <strong>${customerName || 'Customer'}</strong>,</p>
      <p>The repair work on your <strong>${deviceModel}</strong> (Reference: <code>${reference}</code>) has been successfully completed and passed all quality control checks.</p>
      <div style="background-color:#f0fdf4;border-left:4px solid #10b981;padding:12px 16px;margin:16px 0;border-radius:4px">
        <p style="margin:0;font-weight:600;color:#065f46">Technician Update:</p>
        <p style="margin:4px 0 0;color:#047857">${summary}</p>
      </div>
      <p>Your device is now <strong>Ready for Collection</strong> at our service centre. Please bring your reference code (<strong>${reference}</strong>) and a valid photo ID upon pickup.</p>
      <p style="color:#6b7280;font-size:12px;margin-top:24px">RepairFlow Electronic Device Repair Shop</p>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from: `"${fromName}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject,
      text,
      html
    });
    return true;
  } catch (err) {
    console.error(`[Notification Trigger] Failed to send email to ${email}:`, err.message);
    return false;
  }
};

const sendRepairReadyForReturnEmail = async ({ email, customerName, reference, deviceModel, reason, notes }) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[Notification Trigger] Device ready for return (unrepaired) email simulated for ${email} (Job: ${reference})`);
    return false;
  }
  const fromName = process.env.EMAIL_FROM_NAME || 'RepairFlow';
  const subject = `RepairFlow - Your Device is Ready for Return (Ref: ${reference})`;
  const text = [
    `Dear ${customerName || 'Customer'},`,
    `Your ${deviceModel} (Reference: ${reference}) has been prepared and is ready for pickup unrepaired.`,
    `Reason: ${reason}`,
    notes ? `Details: ${notes}` : '',
    'Please visit our service centre with your reference code and a valid photo ID to collect your device.',
    'Thank you for contacting RepairFlow!'
  ].filter(Boolean).join('\n\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:560px;margin:auto">
      <h2 style="color:#d97706;margin-bottom:8px">Device Ready for Pickup (Unrepaired)</h2>
      <p>Dear <strong>${customerName || 'Customer'}</strong>,</p>
      <p>Your <strong>${deviceModel}</strong> (Reference: <code>${reference}</code>) has been prepared and is ready for pickup unrepaired.</p>
      <div style="background-color:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:4px">
        <p style="margin:0;font-weight:600;color:#92400e">Return Reason:</p>
        <p style="margin:4px 0 0;color:#78350f">${reason}</p>
        ${notes ? `<p style="margin:6px 0 0;font-size:13px;color:#78350f"><strong>Notes:</strong> ${notes}</p>` : ''}
      </div>
      <p>Please visit our service centre with your reference code (<strong>${reference}</strong>) and a valid photo ID to collect your device.</p>
      <p style="color:#6b7280;font-size:12px;margin-top:24px">RepairFlow Electronic Device Repair Shop</p>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from: `"${fromName}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject,
      text,
      html
    });
    return true;
  } catch (err) {
    console.error(`[Notification Trigger] Failed to send return email to ${email}:`, err.message);
    return false;
  }
};

const verifyEmailTransport = async () => {
  await getTransporter().verify();
  return true;
};

module.exports = {
  sendOtpEmail,
  sendRepairCompletedEmail,
  sendRepairReadyForReturnEmail,
  assertEmailConfig,
  verifyEmailTransport
};
