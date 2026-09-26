const crypto = require('crypto');
const mongoose = require('mongoose');
const repairJobRepository = require('../repositories/repairJobRepository');
const userRepository = require('../repositories/userRepository');
const estimateRepository = require('../repositories/estimateRepository');
const { getWorkAuthorisation } = require('./repairAuthorisationService');
const { generateJobReference } = require('../utils/jobReference');

const MAX_REFERENCE_ATTEMPTS = 8;

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeRequiredText = (value, fieldName, maxLength) => {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw createHttpError(`${fieldName} is required`, 400);
  }

  if (normalized.length > maxLength) {
    throw createHttpError(`${fieldName} must not exceed ${maxLength} characters`, 400);
  }

  return normalized;
};

const normalizeOptionalText = (value, fieldName, maxLength) => {
  if (value === undefined || value === null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  if (normalized.length > maxLength) {
    throw createHttpError(`${fieldName} must not exceed ${maxLength} characters`, 400);
  }

  return normalized;
};

const normalizeIdempotencyKey = (value) => {
  const key = String(value || '').trim();

  if (!key) {
    throw createHttpError('Idempotency-Key header is required', 400);
  }

  if (key.length > 200) {
    throw createHttpError('Idempotency-Key must not exceed 200 characters', 400);
  }

  return key;
};

const validateCreatePayload = (payload = {}) => {
  const customerId = String(payload.customerId || '').trim();

  if (!customerId) {
    throw createHttpError('customerId is required', 400);
  }

  if (!mongoose.isValidObjectId(customerId)) {
    throw createHttpError('customerId must be a valid MongoDB ObjectId', 400);
  }

  return {
    customerId,
    deviceType: normalizeRequiredText(payload.deviceType, 'Device type', 80),
    makeModel: normalizeRequiredText(payload.makeModel, 'Make/model', 160),
    serialNumber: normalizeOptionalText(payload.serialNumber, 'Serial number', 120),
    reportedFault: normalizeRequiredText(payload.reportedFault, 'Reported fault', 2000)
  };
};

const hashRequest = (payload) => crypto
  .createHash('sha256')
  .update(JSON.stringify(payload))
  .digest('hex');

const serializeCustomer = (customer) => ({
  id: customer._id,
  fullName: customer.fullName,
  email: customer.email,
  contactNumber: customer.contactNumber
});

const serializeRepairJob = (job) => ({
  id: job._id,
  reference: job.reference,
  customer: {
    id: job.customer,
    fullName: job.customerSnapshot.fullName,
    email: job.customerSnapshot.email,
    contactNumber: job.customerSnapshot.contactNumber
  },
  deviceType: job.deviceType,
  makeModel: job.makeModel,
  serialNumber: job.serialNumber || null,
  reportedFault: job.reportedFault,
  receivedAt: job.receivedAt,
  status: job.status,
  createdBy: job.createdBy,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt
});

// SCRUM-41: lightweight DTO for the technician job list.
const serializeJobListItem = (job) => ({
  id: job._id,
  reference: job.reference,
  deviceType: job.deviceType,
  makeModel: job.makeModel,
  reportedFault: job.reportedFault,
  status: job.status,
  receivedAt: job.receivedAt
});

const ensureReplayMatches = (job, requestHash) => {
  if (job.requestHash !== requestHash) {
    throw createHttpError(
      'This Idempotency-Key was already used with different repair job details',
      409
    );
  }

  return {
    created: false,
    idempotentReplay: true,
    message: 'Repair job already registered. Returning the existing job.',
    job: serializeRepairJob(job)
  };
};

const isDuplicateForField = (error, field) => (
  error?.code === 11000 && Boolean(error?.keyPattern?.[field])
);

const createRepairJob = async ({ payload, idempotencyKey, actor }) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can register repair jobs', 403);
  }

  const normalizedPayload = validateCreatePayload(payload);
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
  const requestHash = hashRequest(normalizedPayload);

  const existing = await repairJobRepository.findByIdempotency(actor._id, normalizedKey);
  if (existing) {
    return ensureReplayMatches(existing, requestHash);
  }

  const customer = await userRepository.findRegisteredCustomerById(normalizedPayload.customerId);
  if (!customer) {
    throw createHttpError('Registered customer not found', 404);
  }

  const receivedAt = new Date();
  const baseData = {
    customer: customer._id,
    customerSnapshot: {
      fullName: customer.fullName,
      email: customer.email,
      contactNumber: customer.contactNumber
    },
    deviceType: normalizedPayload.deviceType,
    makeModel: normalizedPayload.makeModel,
    serialNumber: normalizedPayload.serialNumber,
    reportedFault: normalizedPayload.reportedFault,
    receivedAt,
    status: 'Received',
    createdBy: actor._id,
    idempotencyKey: normalizedKey,
    requestHash
  };

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
    try {
      const job = await repairJobRepository.create({
        ...baseData,
        reference: generateJobReference(receivedAt)
      });

      return {
        created: true,
        idempotentReplay: false,
        message: 'Repair job registered successfully',
        job: serializeRepairJob(job)
      };
    } catch (error) {
      // Concurrent double-click/network retry: one request wins the unique
      // idempotency index, and the other replays the exact saved result.
      if (isDuplicateForField(error, 'idempotencyKey')) {
        const replay = await repairJobRepository.findByIdempotency(actor._id, normalizedKey);
        if (replay) return ensureReplayMatches(replay, requestHash);
      }

      // A random display reference collision is extremely unlikely but is
      // still retried so the uniqueness guarantee is database-backed.
      if (isDuplicateForField(error, 'reference')) {
        continue;
      }

      throw error;
    }
  }

  throw createHttpError('Could not allocate a unique repair job reference. Please retry.', 503);
};

const lookupCustomers = async (queryValue, limitValue) => {
  const query = String(queryValue || '').trim();

  if (query.length < 2) {
    throw createHttpError('Customer search query must contain at least 2 characters', 400);
  }

  const parsedLimit = Number.parseInt(limitValue, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 20)
    : 10;

  const customers = await userRepository.searchRegisteredCustomers(query, limit);
  return customers.map(serializeCustomer);
};

// SCRUM-41: return all jobs assigned to the authenticated technician.
const listAssignedJobs = async (technicianId) => {
  const jobs = await repairJobRepository.findAssignedToTechnician(technicianId);
  return jobs.map(serializeJobListItem);
};

// SCRUM-41: return full details of a single job, only when it belongs to the
// requesting technician. Access is rejected with 403 for any other assignment.
const getAssignedJobDetail = async (jobIdentifier, technicianId) => {
  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);

  if (!job) {
    throw createHttpError('Repair job not found', 404);
  }

  // Strict ownership check — even a valid job identifier returns 403 when the
  // job is assigned to a different technician or is currently unassigned.
  const assigned = job.assignedTechnician
    ? String(job.assignedTechnician._id || job.assignedTechnician)
    : null;

  if (!assigned || assigned !== String(technicianId)) {
    throw createHttpError('You do not have permission to access this job', 403);
  }

  // Estimate revision: tell the technician whether repair work or completion is
  // currently authorised by the latest approved estimate version.
  const currentEstimate = await estimateRepository.findCurrentByJob(job);
  return {
    ...serializeRepairJob(job),
    workAuthorisation: await getWorkAuthorisation(job, currentEstimate)
  };
};

module.exports = {
  createRepairJob,
  lookupCustomers,
  serializeRepairJob,
  listAssignedJobs,
  getAssignedJobDetail
};
