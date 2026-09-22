const userRepository = require('../repositories/userRepository');
const otpService = require('./otpService');
const internalAuthService = require('./internalAuthService');

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const createTechnician = async (payload = {}) => {
  const account = internalAuthService.validateAccountPayload(payload, 'technician');
  const existing = await userRepository.findByEmail(account.email);

  // Duplicate emails are rejected even when a previous technician is still
  // awaiting OTP verification. The resend endpoint exists for that case.
  if (existing) {
    throw createHttpError('An account with this email address already exists', 409);
  }

  let technician;
  try {
    technician = await userRepository.createPendingInternalUser({
      ...account,
      role: 'technician'
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw createHttpError('An account with this email address already exists', 409);
    }
    throw error;
  }

  const otpInfo = await otpService.issueOtp(
    technician,
    internalAuthService.ROLE_CONFIG.technician.registrationPurpose
  );

  return {
    message: 'Technician account created as pending. Verification OTP sent to the technician email.',
    requiresOtp: true,
    technician: internalAuthService.sanitizeUser(technician),
    ...otpInfo
  };
};

const listTechnicians = async (status = 'active') => {
  const normalizedStatus = String(status || 'active').trim().toLowerCase();
  if (!['active', 'disabled', 'all'].includes(normalizedStatus)) {
    throw createHttpError('status must be one of: active, disabled, all', 400);
  }

  const technicians = await userRepository.listTechnicians(normalizedStatus);
  return technicians.map(internalAuthService.sanitizeUser);
};

const toggleTechnicianActive = async (technicianId) => {
  const technician = await userRepository.findById(technicianId, { includeSessions: true });

  if (!technician || technician.role !== 'technician') {
    throw createHttpError('Technician account not found', 404);
  }

  if (!technician.isEmailVerified) {
    throw createHttpError('Technician email must be verified before the account can be enabled or disabled', 400);
  }

  technician.isActive = !technician.isActive;

  if (!technician.isActive) {
    technician.activeSessions = [];
    await otpService.deleteUserOtps(technician._id);
  }

  await userRepository.save(technician);

  return {
    message: technician.isActive
      ? 'Technician account enabled successfully'
      : 'Technician account disabled successfully',
    technician: internalAuthService.sanitizeUser(technician)
  };
};

module.exports = {
  createTechnician,
  listTechnicians,
  toggleTechnicianActive
};
