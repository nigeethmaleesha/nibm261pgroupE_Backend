const crypto = require('crypto');
const mongoose = require('mongoose');
const repairJobRepository = require('../repositories/repairJobRepository');
const jobProgressLogRepository = require('../repositories/jobProgressLogRepository');
const estimateRepository = require('../repositories/estimateRepository');
const { assertRepairWorkAllowed, getWorkAuthorisation } = require('./repairAuthorisationService');
const { assertNotAwaitingApproval } = require('./repairProgressService');

/*
 * Technician progress updates while a job is In Repair (job_progress_logs).
 * One submit = one entry = two rows sharing `entryId`:
 *   is_public: false -> internal work note, is_public: true -> customer update.
 *
 * - Only the assigned technician can record, only while the job is In Repair
 *   under the latest approved estimate and with no active parts hold. The
 *   state is rechecked inside the save transaction.
 * - Both texts must be non-empty.
 * - Retrying with the same Idempotency-Key replays the saved entry.
 * - Entries are immutable; a correction is a new entry with a reason.
 */

const WORK_NOTE_MAX = 2000;
const PUBLIC_UPDATE_MAX = 1000;
const CORRECTION_REASON_MAX = 500;

const createHttpError = (message, statusCode, code, details) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.codeName = code;
  if (details) error.details = details;
  return error;
};

const normalizeRequiredText = (value, field, maxLength) => {
  const text = String(value ?? '').trim();
  if (!text) {
    throw createHttpError(`${field} is required`, 422, 'VALIDATION_ERROR');
  }
  if (text.length > maxLength) {
    throw createHttpError(`${field} must not exceed ${maxLength} characters`, 422, 'VALIDATION_ERROR');
  }
  return text;
};

const normalizeIdempotencyKey = (value) => {
  const key = String(value ?? '').trim();
  if (!key) {
    throw createHttpError('Idempotency-Key header is required', 400, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  if (key.length > 200) {
    throw createHttpError('Idempotency-Key must not exceed 200 characters', 400, 'VALIDATION_ERROR');
  }
  return key;
};

const normalizePayload = (payload = {}) => {
  const workNote = normalizeRequiredText(payload.workNote, 'workNote', WORK_NOTE_MAX);
  const publicUpdate = normalizeRequiredText(payload.publicUpdate, 'publicUpdate', PUBLIC_UPDATE_MAX);

  let correctionOf = null;
  let correctionReason = null;
  const rawCorrectionOf = String(payload.correctionOf ?? '').trim();
  if (rawCorrectionOf) {
    if (!mongoose.isValidObjectId(rawCorrectionOf)) {
      throw createHttpError('correctionOf must be a valid progress update id', 422, 'VALIDATION_ERROR');
    }
    correctionOf = rawCorrectionOf;
    correctionReason = normalizeRequiredText(
      payload.correctionReason,
      'correctionReason',
      CORRECTION_REASON_MAX
    );
  } else if (String(payload.correctionReason ?? '').trim()) {
    throw createHttpError('correctionReason is only allowed together with correctionOf', 422, 'VALIDATION_ERROR');
  }

  let estimateVersionNumber = null;
  if (payload.estimateVersionNumber !== undefined && payload.estimateVersionNumber !== null && payload.estimateVersionNumber !== '') {
    estimateVersionNumber = Number(payload.estimateVersionNumber);
    if (!Number.isSafeInteger(estimateVersionNumber) || estimateVersionNumber < 1) {
      throw createHttpError('estimateVersionNumber must be a positive whole number', 422, 'VALIDATION_ERROR');
    }
  }

  return { workNote, publicUpdate, correctionOf, correctionReason, estimateVersionNumber };
};

// The optional version guard is left out so a retry after the approval has
// changed still replays the entry that was already saved.
const hashRequest = ({ workNote, publicUpdate, correctionOf, correctionReason }) => crypto
  .createHash('sha256')
  .update(JSON.stringify({ workNote, publicUpdate, correctionOf, correctionReason }))
  .digest('hex');

const sameId = (left, right) => (
  Boolean(left) && Boolean(right) && String(left._id || left) === String(right._id || right)
);

// insertMany wraps duplicate-key errors (keyPattern is not on the top-level
// error), so match on the unique index name that is always in the message.
const isDuplicateForIndex = (error, indexName) => {
  if (error?.code !== 11000) return false;
  const messages = [error.message, ...(error.writeErrors || []).map((w) => w?.errmsg || w?.err?.errmsg)];
  return messages.some((message) => typeof message === 'string' && message.includes(indexName));
};

const loadJob = async (jobIdentifier) => {
  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);
  if (!job) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }
  return job;
};

const assertInternalReader = (job, actor) => {
  if (!actor || !['owner_staff', 'technician'].includes(actor.role)) {
    throw createHttpError('Only Owner/Staff or the assigned technician can view progress updates', 403, 'FORBIDDEN');
  }
  if (actor.role === 'technician' && !sameId(job.assignedTechnician, actor._id)) {
    throw createHttpError('You do not have permission to access this job', 403, 'FORBIDDEN');
  }
};

const serializeRecordedBy = (recordedBy, fallbackName = null) => {
  if (recordedBy && recordedBy.fullName !== undefined) {
    return { id: recordedBy._id, fullName: recordedBy.fullName || null };
  }
  return { id: recordedBy, fullName: fallbackName };
};

// Groups the private/public rows of each entry, newest entry first.
const groupEntries = (rows) => {
  const byEntry = new Map();
  for (const row of rows) {
    const key = String(row.entryId);
    if (!byEntry.has(key)) byEntry.set(key, {});
    byEntry.get(key)[row.is_public ? 'publicRow' : 'privateRow'] = row;
  }
  return [...byEntry.values()].filter((pair) => pair.privateRow && pair.publicRow);
};

// Internal view (technician / Owner/Staff): both rows of the entry.
const serializeInternalEntry = ({ privateRow, publicRow }, { correctedBy = null, recordedByName = null } = {}) => ({
  id: privateRow.entryId,
  workNote: privateRow.text,
  publicUpdate: publicRow.text,
  logs: [privateRow, publicRow].map((row) => ({
    id: row._id,
    is_public: row.is_public,
    text: row.text
  })),
  estimateId: privateRow.estimate,
  estimateVersionNumber: privateRow.estimateVersionNumber,
  jobStatus: privateRow.jobStatus,
  recordedBy: serializeRecordedBy(privateRow.recordedBy, recordedByName),
  recordedByRole: privateRow.recordedByRole,
  recordedAt: privateRow.createdAt,
  isCorrection: Boolean(privateRow.correctionOf),
  correctionOf: privateRow.correctionOf || null,
  correctionReason: privateRow.correctionReason || null,
  correctedBy,
  isCurrent: !correctedBy
});

// Customer view: allow-list over is_public rows only. The technician and the
// correction reason are never included.
const serializePublicUpdate = (row) => ({
  id: row.entryId,
  message: row.text,
  estimateVersionNumber: row.estimateVersionNumber,
  isCorrection: Boolean(row.correctionOf),
  recordedAt: row.createdAt
});

const buildResult = (pair, { created, actor }) => ({
  created,
  idempotentReplay: !created,
  message: created
    ? (pair.privateRow.correctionOf ? 'Correction recorded' : 'Work progress recorded')
    : 'This progress update was already recorded. Returning the saved entry.',
  entry: serializeInternalEntry(pair, { recordedByName: actor.fullName || null })
});

const replayOrConflict = (rows, requestHash, actor) => {
  const [pair] = groupEntries(rows);
  if (!pair) return null;
  if (pair.privateRow.requestHash !== requestHash) {
    throw createHttpError(
      'This Idempotency-Key was already used with different progress update details',
      409,
      'IDEMPOTENCY_KEY_REUSED'
    );
  }
  return buildResult(pair, { created: false, actor });
};

// Reasons the assigned technician cannot record progress right now.
const recordBlockedReasons = (job, authorisation) => {
  const reasons = [];
  if (job.status === 'Awaiting Approval') {
    reasons.push('Repair progress is locked while the latest estimate is awaiting customer approval');
  } else if (job.status !== 'In Repair') {
    reasons.push(`Work progress can only be recorded while the job is In Repair (current: ${job.status})`);
  }
  if (job.partsHold?.active) {
    reasons.push('An unresolved parts hold is active. Resolve it and resume repair first.');
  }
  for (const reason of authorisation.repairBlockedReasons) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return reasons;
};

const assertCanRecord = async (job, requestedVersion) => {
  await assertNotAwaitingApproval(job);

  if (job.status !== 'In Repair') {
    throw createHttpError(
      `Work progress can only be recorded while the job is In Repair (current: ${job.status})`,
      409,
      'INVALID_JOB_STATUS',
      { jobStatus: job.status }
    );
  }
  if (job.partsHold?.active) {
    throw createHttpError(
      'An unresolved parts hold is active. Resolve it and resume repair before recording work progress.',
      409,
      'PARTS_HOLD_ACTIVE'
    );
  }

  const authorisation = await assertRepairWorkAllowed(job, 'REPAIR');

  // Approval changed since the technician loaded the screen.
  if (requestedVersion !== null && requestedVersion !== authorisation.approvedVersionNumber) {
    throw createHttpError(
      `Estimate version ${requestedVersion} is no longer the approved version (current approved: ${authorisation.approvedVersionNumber}). Refresh and try again.`,
      409,
      'ESTIMATE_SUPERSEDED'
    );
  }

  return authorisation;
};

const recordProgressUpdate = async ({ jobIdentifier, payload = {}, idempotencyKey, actor }) => {
  if (!actor || actor.role !== 'technician') {
    throw createHttpError('Only the assigned technician can record work progress', 403, 'FORBIDDEN');
  }

  const normalized = normalizePayload(payload);
  const key = normalizeIdempotencyKey(idempotencyKey);
  const requestHash = hashRequest(normalized);

  const job = await loadJob(jobIdentifier);
  assertInternalReader(job, actor);

  // A retry of a request that already succeeded replays it, even if the job
  // has moved on since then.
  const existing = await jobProgressLogRepository.findByIdempotency(actor._id, job._id, key);
  const replay = replayOrConflict(existing, requestHash, actor);
  if (replay) return replay;

  const authorisation = await assertCanRecord(job, normalized.estimateVersionNumber);

  const session = await mongoose.startSession();
  let pair;
  try {
    await session.withTransaction(async () => {
      const recordedAt = new Date();
      const touched = await repairJobRepository.touchProgressLog(
        job._id,
        {
          technicianId: actor._id,
          expectedEstimateId: authorisation.approvedEstimateId,
          recordedAt
        },
        session
      );
      if (!touched) {
        throw createHttpError(
          'This repair job changed while your update was being saved. Refresh and try again.',
          409,
          'STATE_CONFLICT'
        );
      }

      if (normalized.correctionOf) {
        const originalRows = await jobProgressLogRepository.findEntryRows(
          normalized.correctionOf,
          job._id,
          { session }
        );
        if (originalRows.length === 0) {
          throw createHttpError('The progress update to correct was not found on this job', 404, 'NOT_FOUND');
        }
        const laterCorrection = await jobProgressLogRepository.findCorrectionOf(
          normalized.correctionOf,
          { session }
        );
        if (laterCorrection) {
          throw createHttpError(
            'This progress update has already been corrected. Correct the latest entry instead.',
            409,
            'ALREADY_CORRECTED',
            { correctedBy: laterCorrection.entryId }
          );
        }
      }

      const entryId = new mongoose.Types.ObjectId();
      const shared = {
        job: job._id,
        entryId,
        estimate: authorisation.approvedEstimateId,
        estimateVersionNumber: authorisation.approvedVersionNumber,
        jobStatus: touched.status,
        recordedBy: actor._id,
        recordedByRole: actor.role,
        correctionOf: normalized.correctionOf,
        correctionReason: normalized.correctionReason,
        idempotencyKey: key,
        requestHash
      };
      const rows = await jobProgressLogRepository.createRows([
        { ...shared, is_public: false, text: normalized.workNote },
        { ...shared, is_public: true, text: normalized.publicUpdate }
      ], session);
      [pair] = groupEntries(rows);
    });
  } catch (error) {
    // Two identical requests at once: one wins, the other replays it.
    if (isDuplicateForIndex(error, 'unique_job_progress_log_idempotency')) {
      const rows = await jobProgressLogRepository.findByIdempotency(actor._id, job._id, key);
      const concurrentReplay = replayOrConflict(rows, requestHash, actor);
      if (concurrentReplay) return concurrentReplay;
    }
    if (isDuplicateForIndex(error, 'unique_job_progress_log_correction')) {
      throw createHttpError(
        'This progress update has already been corrected. Correct the latest entry instead.',
        409,
        'ALREADY_CORRECTED'
      );
    }
    if (error.codeName === 'STATE_CONFLICT') {
      // Explain the real reason (approval changed, hold placed, status moved).
      const latest = await repairJobRepository.findByIdOrReference(String(job._id));
      if (latest) {
        assertInternalReader(latest, actor);
        await assertCanRecord(latest, null);
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return buildResult(pair, { created: true, actor });
};

const listProgressUpdates = async ({ jobIdentifier, actor }) => {
  const job = await loadJob(jobIdentifier);
  assertInternalReader(job, actor);

  const [rows, currentEstimate] = await Promise.all([
    jobProgressLogRepository.listByJob(job._id),
    estimateRepository.findCurrentByJob(job)
  ]);
  const authorisation = await getWorkAuthorisation(job, currentEstimate);
  const entries = groupEntries(rows);

  const correctedBy = new Map();
  for (const { privateRow } of entries) {
    if (privateRow.correctionOf) correctedBy.set(String(privateRow.correctionOf), privateRow.entryId);
  }

  const reasons = recordBlockedReasons(job, authorisation);
  if (actor.role !== 'technician') {
    reasons.unshift('Only the assigned technician can record work progress');
  }

  return {
    job: {
      id: job._id,
      reference: job.reference,
      status: job.status,
      revision: job.revision || 0
    },
    approvedVersionNumber: authorisation.approvedVersionNumber,
    canRecord: reasons.length === 0,
    recordBlockedReasons: reasons,
    entries: entries.map((pair) => serializeInternalEntry(pair, {
      correctedBy: correctedBy.get(String(pair.privateRow.entryId)) || null
    }))
  };
};

const listCustomerProgressUpdates = async ({ jobIdentifier, actor }) => {
  if (!actor || actor.role !== 'customer') {
    throw createHttpError('Only customers can view these progress updates', 403, 'FORBIDDEN');
  }

  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);
  // Missing and cross-customer jobs return the same response.
  if (!job || !sameId(job.customer, actor._id)) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  const publicRows = await jobProgressLogRepository.listPublicByJob(job._id);
  const corrected = new Set(
    publicRows.filter((row) => row.correctionOf).map((row) => String(row.correctionOf))
  );

  return {
    job: {
      reference: job.reference,
      status: job.status
    },
    // A corrected entry is replaced by its correction for the customer.
    updates: publicRows
      .filter((row) => row.is_public === true && !corrected.has(String(row.entryId)))
      .map(serializePublicUpdate)
  };
};

module.exports = {
  recordProgressUpdate,
  listProgressUpdates,
  listCustomerProgressUpdates
};
