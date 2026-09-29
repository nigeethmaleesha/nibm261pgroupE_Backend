const repairJobRepository = require('../repositories/repairJobRepository');
const repairProgressRepository = require('../repositories/repairProgressRepository');
const estimateRepository = require('../repositories/estimateRepository');
const { JOB_STATUSES } = require('../models/RepairJob');
const { assertRepairWorkAllowed } = require('./repairAuthorisationService');

/*
 * Repair progress updates (status changes and notes) by the assigned technician
 * or Owner/Staff. Progress is locked while the job is Awaiting Approval: once a
 * new or revised estimate is issued, nothing moves until the customer approves
 * the latest version.
 */

// Allowed status changes. `authorisation` is the repair-authorisation check the
// latest estimate must pass: REPAIR (work) or COMPLETE (work + no parts hold).
const TRANSITIONS = {
  Approved: {
    'In Repair': { authorisation: 'REPAIR' },
    'Waiting for Parts': { authorisation: 'REPAIR' }
  },
  'In Repair': {
    'Waiting for Parts': { authorisation: 'REPAIR' },
    'Ready for Collection': { authorisation: 'COMPLETE' }
  },
  'Waiting for Parts': {
    'In Repair': { authorisation: 'REPAIR', releasesPartsHold: true }
  },
  // Device returned unrepaired after the customer rejected the estimate. This
  // is not repair work, so it needs no approved estimate. Owner/Staff only.
  'Estimate Rejected': {
    'Ready for Return': { authorisation: null, roles: ['owner_staff'] }
  }
};

// Statuses where a note can be added without changing status.
const NOTE_ONLY_STATUSES = ['Approved', 'In Repair', 'Waiting for Parts'];

const createHttpError = (message, statusCode, code, details) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.codeName = code;
  if (details) error.details = details;
  return error;
};

const normalizeStatus = (value) => {
  if (value === undefined || value === null || value === '') return null;

  const status = String(value).trim();
  const match = JOB_STATUSES.find((item) => item.toLowerCase() === status.toLowerCase());
  if (!match) {
    throw createHttpError(`status must be one of: ${JOB_STATUSES.join(', ')}`, 422, 'VALIDATION_ERROR');
  }
  return match;
};

const normalizeNote = (value) => {
  const note = String(value ?? '').trim();
  if (!note) return null;
  if (note.length > 1000) {
    throw createHttpError('note must not exceed 1000 characters', 422, 'VALIDATION_ERROR');
  }
  return note;
};

const normalizeExpectedRevision = (value) => {
  if (value === undefined || value === null || value === '') return null;

  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw createHttpError('expectedRevision must be a non-negative whole number', 422, 'VALIDATION_ERROR');
  }
  return revision;
};

const sameId = (left, right) => (
  Boolean(left) && Boolean(right) && String(left._id || left) === String(right._id || right)
);

const assertActorCanAccessJob = (job, actor) => {
  if (!actor || !['owner_staff', 'technician'].includes(actor.role)) {
    throw createHttpError('Only Owner/Staff or the assigned technician can update repair progress', 403, 'FORBIDDEN');
  }
  if (actor.role === 'technician' && !sameId(job.assignedTechnician, actor._id)) {
    throw createHttpError('You do not have permission to access this job', 403, 'FORBIDDEN');
  }
};

const loadJob = async (jobIdentifier) => {
  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);
  if (!job) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }
  return job;
};

const assertNotAwaitingApproval = async (job) => {
  if (job.status !== 'Awaiting Approval') return;

  const currentEstimate = await estimateRepository.findCurrentByJob(job);
  const version = currentEstimate ? currentEstimate.versionNumber : null;
  throw createHttpError(
    version
      ? `Repair progress is locked while estimate version ${version} is awaiting customer approval`
      : 'Repair progress is locked while the job is awaiting estimate approval',
    409,
    'REPAIR_LOCKED',
    {
      jobStatus: job.status,
      awaitingVersionNumber: version,
      reason: 'The customer must approve the latest estimate before repair progress can be updated'
    }
  );
};

const serializeUpdate = (update) => ({
  id: update._id,
  fromStatus: update.fromStatus,
  toStatus: update.toStatus,
  statusChanged: update.fromStatus !== update.toStatus,
  note: update.note || null,
  estimateVersionNumber: update.estimateVersionNumber,
  updatedBy: update.updatedBy,
  updatedByRole: update.updatedByRole,
  createdAt: update.createdAt
});

const serializeJob = (job) => ({
  id: job._id,
  reference: job.reference,
  status: job.status,
  revision: job.revision || 0,
  partsHold: {
    active: Boolean(job.partsHold?.active),
    reason: job.partsHold?.reason || null,
    placedAt: job.partsHold?.placedAt || null,
    releasedAt: job.partsHold?.releasedAt || null
  }
});

const updateProgress = async ({ jobIdentifier, payload = {}, actor }) => {
  const requestedStatus = normalizeStatus(payload.status);
  const note = normalizeNote(payload.note);
  const expectedRevision = normalizeExpectedRevision(payload.expectedRevision);

  if (!requestedStatus && !note) {
    throw createHttpError('Provide a new status, a progress note, or both', 422, 'VALIDATION_ERROR');
  }

  const job = await loadJob(jobIdentifier);
  assertActorCanAccessJob(job, actor);

  // The lock is checked before anything else so an Awaiting Approval job always
  // reports REPAIR_LOCKED, whatever update was attempted.
  await assertNotAwaitingApproval(job);

  if (expectedRevision !== null && expectedRevision !== (job.revision || 0)) {
    throw createHttpError(
      'This repair job has changed since you loaded it. Refresh and try again.',
      409,
      'STATE_CONFLICT'
    );
  }

  const fromStatus = job.status;
  const toStatus = requestedStatus || fromStatus;
  let rule;

  if (toStatus === fromStatus) {
    if (!NOTE_ONLY_STATUSES.includes(fromStatus)) {
      throw createHttpError(
        `Progress notes cannot be added while the job is ${fromStatus}`,
        409,
        'STATE_CONFLICT'
      );
    }
    rule = { authorisation: 'REPAIR' };
  } else {
    rule = TRANSITIONS[fromStatus]?.[toStatus];
    if (!rule) {
      const allowed = Object.keys(TRANSITIONS[fromStatus] || {});
      throw createHttpError(
        `Cannot change repair status from ${fromStatus} to ${toStatus}`,
        409,
        'INVALID_STATUS_TRANSITION',
        { fromStatus, toStatus, allowedStatuses: allowed }
      );
    }
    if (rule.roles && !rule.roles.includes(actor.role)) {
      throw createHttpError(
        `Only Owner/Staff can change repair status to ${toStatus}`,
        403,
        'FORBIDDEN'
      );
    }
  }

  // An active parts hold must go through Waiting for Parts, which is the only
  // status that releases it, before repair continues.
  if (fromStatus === 'Approved' && toStatus === 'In Repair' && job.partsHold?.active) {
    throw createHttpError(
      'An unresolved parts hold is active. Move the job to Waiting for Parts, then to In Repair when the parts arrive.',
      409,
      'PARTS_HOLD_ACTIVE'
    );
  }

  const authorisation = rule.authorisation
    ? await assertRepairWorkAllowed(job, rule.authorisation)
    : null;

  const now = new Date();
  const set = { status: toStatus };
  if (toStatus === 'Waiting for Parts' && !job.partsHold?.active) {
    set.partsHold = {
      active: true,
      reason: note || 'Waiting for parts',
      placedAt: now,
      releasedAt: null
    };
  }
  if (rule.releasesPartsHold) {
    set['partsHold.active'] = false;
    set['partsHold.releasedAt'] = now;
  }

  const updatedJob = await repairJobRepository.applyProgressUpdate(job._id, {
    expectedStatus: fromStatus,
    expectedRevision: job.revision || 0,
    expectedEstimateId: job.currentEstimate,
    set
  });

  if (!updatedJob) {
    // Most likely a revised estimate was issued in the meantime. Re-read so the
    // caller gets REPAIR_LOCKED when that is the reason.
    const latest = await repairJobRepository.findByIdOrReference(String(job._id));
    if (latest) await assertNotAwaitingApproval(latest);
    throw createHttpError(
      'This repair job changed while your update was being saved. Refresh and try again.',
      409,
      'STATE_CONFLICT'
    );
  }

  const update = await repairProgressRepository.createUpdate({
    job: job._id,
    fromStatus,
    toStatus,
    note,
    estimateVersionNumber: authorisation ? authorisation.approvedVersionNumber : null,
    updatedBy: actor._id,
    updatedByRole: actor.role
  });

  return {
    message: toStatus === fromStatus
      ? 'Repair progress note added'
      : `Repair status updated from ${fromStatus} to ${toStatus}`,
    job: serializeJob(updatedJob),
    update: serializeUpdate(update)
  };
};

const getProgressHistory = async ({ jobIdentifier, actor }) => {
  const job = await loadJob(jobIdentifier);
  assertActorCanAccessJob(job, actor);

  const updates = await repairProgressRepository.listByJob(job._id);
  return {
    job: serializeJob(job),
    isLocked: job.status === 'Awaiting Approval',
    allowedStatuses: job.status === 'Awaiting Approval'
      ? []
      : Object.entries(TRANSITIONS[job.status] || {})
        .filter(([, rule]) => !rule.roles || rule.roles.includes(actor.role))
        .map(([status]) => status),
    updates: updates.map(serializeUpdate)
  };
};

module.exports = {
  updateProgress,
  getProgressHistory
};
