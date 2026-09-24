const crypto = require('crypto');
const mongoose = require('mongoose');
const repairJobRepository = require('../repositories/repairJobRepository');
const userRepository = require('../repositories/userRepository');
const repairJobAssignmentAuditRepository = require('../repositories/repairJobAssignmentAuditRepository');
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


const serializeInternalUser = (user) => {
  if (!user) return null;
  return {
    id: user._id || user.id,
    fullName: user.fullName,
    email: user.email,
    contactNumber: user.contactNumber || null,
    role: user.role,
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified
  };
};

const serializeStaffJobListItem = (job) => ({
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
  assignedTechnician: serializeInternalUser(job.assignedTechnician),
  assignedAt: job.assignedAt || null,
  revision: job.revision || 0,
  updatedAt: job.updatedAt
});

const serializeStaffJobDetail = (job) => ({
  ...serializeStaffJobListItem(job),
  createdAt: job.createdAt,
  assignment: {
    technician: serializeInternalUser(job.assignedTechnician),
    assignedBy: serializeInternalUser(job.assignedBy),
    assignedAt: job.assignedAt || null
  },
  currentEstimate: job.currentEstimate && job.currentEstimate._id
    ? {
        id: job.currentEstimate._id,
        versionNumber: job.currentEstimate.versionNumber,
        currency: job.currentEstimate.currency,
        totalMinor: job.currentEstimate.totalMinor,
        status: job.currentEstimate.status,
        issuedAt: job.currentEstimate.issuedAt,
        decision: job.currentEstimate.decision?.action
          ? {
              action: job.currentEstimate.decision.action,
              decidedBy: job.currentEstimate.decision.decidedBy || null,
              decidedAt: job.currentEstimate.decision.decidedAt || null
            }
          : null
      }
    : null
});

const normalizeStaffSearchLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 100);
};

// SCRUM-10: shop-wide search is intentionally Owner/Staff-only.
const searchStaffRepairJobs = async ({ queryValue, limitValue, actor }) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can search all repair jobs', 403);
  }

  const query = String(queryValue || '').trim();
  if (query.length > 120) {
    throw createHttpError('Repair job search query must not exceed 120 characters', 400);
  }

  const jobs = await repairJobRepository.searchForStaff(
    query,
    normalizeStaffSearchLimit(limitValue)
  );

  return jobs.map(serializeStaffJobListItem);
};

// SCRUM-10: selected result detail keeps the original intake snapshot together
// with assignment and current repair/estimate state.
const getStaffRepairJobDetail = async ({ jobIdentifier, actor }) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can view shop-wide repair job details', 403);
  }

  const job = await repairJobRepository.findForStaffDetail(jobIdentifier);
  if (!job) {
    throw createHttpError('Repair job not found', 404);
  }

  return serializeStaffJobDetail(job);
};

const normalizeTechnicianId = (value) => {
  const technicianId = String(value || '').trim();

  if (!technicianId) {
    throw createHttpError('technicianId is required', 400);
  }

  if (!mongoose.isValidObjectId(technicianId)) {
    throw createHttpError('technicianId must be a valid MongoDB ObjectId', 400);
  }

  return technicianId;
};

// SCRUM-11: assign/reassign an open repair job to an active, verified
// technician. The assignment and immutable audit row are committed together.
const assignRepairJob = async ({ jobIdentifier, payload = {}, actor }) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can assign repair jobs', 403);
  }

  const technicianId = normalizeTechnicianId(payload.technicianId);
  const session = await mongoose.startSession();
  let changed = false;

  try {
    await session.withTransaction(async () => {
      const job = await repairJobRepository.findByIdOrReference(jobIdentifier, { session });
      if (!job) {
        throw createHttpError('Repair job not found', 404);
      }

      if (job.status === 'Collected') {
        throw createHttpError(
          'Collected repair jobs cannot be assigned or reassigned',
          409
        );
      }

      const technician = await userRepository.findActiveVerifiedTechnicianById(
        technicianId,
        { session }
      );

      if (!technician) {
        throw createHttpError(
          'Active verified technician account not found',
          404
        );
      }

      const previousTechnicianId = job.assignedTechnician
        ? String(job.assignedTechnician)
        : null;

      if (previousTechnicianId === String(technician._id)) {
        changed = false;
        return;
      }

      const assignedAt = new Date();
      const updatedJob = await repairJobRepository.assignTechnician(
        job._id,
        technician._id,
        actor._id,
        assignedAt,
        job.revision || 0,
        session
      );

      if (!updatedJob) {
        throw createHttpError(
          'Repair job changed while the assignment was being saved. Refresh and try again.',
          409
        );
      }

      await repairJobAssignmentAuditRepository.create({
        job: job._id,
        action: previousTechnicianId ? 'REASSIGNED' : 'ASSIGNED',
        previousTechnician: previousTechnicianId,
        assignedTechnician: technician._id,
        assignedBy: actor._id,
        assignedAt,
        jobStatus: job.status
      }, session);

      changed = true;
    });
  } catch (error) {
    if (
      /Transaction numbers are only allowed|replica set member|mongos/i.test(
        error?.message || ''
      )
    ) {
      throw createHttpError(
        'Technician assignment audit logging requires MongoDB transaction support. Use MongoDB Atlas or a replica-set deployment.',
        503
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }

  const job = await getStaffRepairJobDetail({ jobIdentifier, actor });
  return {
    changed,
    message: changed
      ? 'Technician assigned successfully'
      : 'This technician is already assigned to the repair job',
    job
  };
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

  return serializeRepairJob(job);
};

module.exports = {
  createRepairJob,
  lookupCustomers,
  serializeRepairJob,
  searchStaffRepairJobs,
  getStaffRepairJobDetail,
  assignRepairJob,
  listAssignedJobs,
  getAssignedJobDetail
};
