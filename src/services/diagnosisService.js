const mongoose = require('mongoose');
const diagnosisRepository = require('../repositories/diagnosisRepository');
const repairJobRepository = require('../repositories/repairJobRepository');

const createHttpError = (message, statusCode, codeName = null, details = null) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (codeName) error.codeName = codeName;
  if (details) error.details = details;
  return error;
};

const sameId = (left, right) => (
  Boolean(left) && Boolean(right) && String(left) === String(right)
);

const normalizeText = (value, fieldName, maxLength, { required = false } = {}) => {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) {
    throw createHttpError(`${fieldName} is required`, 400, 'VALIDATION_ERROR');
  }
  if (normalized.length > maxLength) {
    throw createHttpError(
      `${fieldName} must not exceed ${maxLength} characters`,
      400,
      'VALIDATION_ERROR'
    );
  }
  return normalized;
};

const serializeJobState = (job) => ({
  id: job._id,
  reference: job.reference,
  status: job.status,
  revision: job.revision || 0,
  diagnosisState: job.diagnosisState || 'Not Started',
  diagnosisStartedAt: job.diagnosisStartedAt || null,
  diagnosisRecordedAt: job.diagnosisRecordedAt || null
});

const serializeTechnicianDiagnosis = (diagnosis) => {
  if (!diagnosis) return null;
  return {
    id: diagnosis._id,
    state: diagnosis.state,
    findings: diagnosis.findings || '',
    recommendedWork: diagnosis.recommendedWork || '',
    publicSummary: diagnosis.publicSummary || '',
    internalNotes: diagnosis.internalNotes || '',
    isUnrepairable: Boolean(diagnosis.isUnrepairable),
    unrepairableReason: diagnosis.unrepairableReason || null,
    startedAt: diagnosis.startedAt,
    startedBy: diagnosis.startedBy,
    lastUpdatedBy: diagnosis.lastUpdatedBy || null,
    completedAt: diagnosis.completedAt || null,
    completedBy: diagnosis.completedBy || null,
    isCompleted: Boolean(
      diagnosis.completedAt || diagnosis.isCompleted || diagnosis.diagnosisCompleted
    ),
    updatedAt: diagnosis.updatedAt
  };
};

const serializeStaffDiagnosis = (diagnosis) => serializeTechnicianDiagnosis(diagnosis);

// Customer-facing DTO is deliberately allow-listed. Findings, recommendations,
// internal notes and technician identifiers are never copied into this object.
const serializePublicDiagnosis = (diagnosis) => {
  if (!diagnosis) return null;
  return {
    state: 'Diagnosis Recorded',
    publicSummary: diagnosis.publicSummary || '',
    isUnrepairable: Boolean(diagnosis.isUnrepairable),
    completedAt: diagnosis.completedAt || null
  };
};

const ensureAssignedTechnician = (job, actor) => {
  if (!actor || actor.role !== 'technician') {
    throw createHttpError('Only technicians can perform diagnosis actions', 403, 'FORBIDDEN');
  }

  const assignedId = job?.assignedTechnician?._id || job?.assignedTechnician;
  if (!assignedId || !sameId(assignedId, actor._id)) {
    throw createHttpError(
      'You do not have permission to diagnose this repair job',
      403,
      'FORBIDDEN'
    );
  }
};

const loadAssignedJob = async (jobIdentifier, actor, { session = null } = {}) => {
  const job = await repairJobRepository.findByIdOrReference(jobIdentifier, { session });
  if (!job) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }
  ensureAssignedTechnician(job, actor);
  return job;
};

const getTechnicianDiagnosis = async ({ jobIdentifier, actor }) => {
  const job = await loadAssignedJob(jobIdentifier, actor);
  const diagnosis = await diagnosisRepository.findByJob(job._id);
  const completed = Boolean(
    diagnosis?.completedAt || diagnosis?.isCompleted || diagnosis?.diagnosisCompleted
  );

  return {
    job: serializeJobState(job),
    diagnosis: serializeTechnicianDiagnosis(diagnosis),
    permissions: {
      canStart: job.status === 'Received' && !diagnosis,
      canEdit: job.status === 'Diagnosing' && Boolean(diagnosis) && !completed,
      canComplete: job.status === 'Diagnosing' && Boolean(diagnosis) && !completed
    }
  };
};

const transactionUnavailable = (error) => (
  /Transaction numbers are only allowed|replica set member|mongos/i.test(error?.message || '')
);

const startDiagnosis = async ({ jobIdentifier, actor }) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      let job = await loadAssignedJob(jobIdentifier, actor, { session });
      let diagnosis = await diagnosisRepository.findByJob(job._id, { session });

      if (diagnosis && (
        diagnosis.completedAt || diagnosis.isCompleted || diagnosis.diagnosisCompleted
      )) {
        result = {
          started: false,
          message: 'Diagnosis has already been recorded for this repair job',
          job: serializeJobState(job),
          diagnosis: serializeTechnicianDiagnosis(diagnosis)
        };
        return;
      }

      if (!['Received', 'Diagnosing'].includes(job.status)) {
        throw createHttpError(
          `Diagnosis cannot be started when the job status is ${job.status}`,
          409,
          'STATE_CONFLICT'
        );
      }

      const startedAt = diagnosis?.startedAt || new Date();
      let started = false;

      if (job.status === 'Received') {
        const updatedJob = await repairJobRepository.startDiagnosis(
          job._id,
          actor._id,
          job.revision || 0,
          startedAt,
          session
        );

        if (!updatedJob) {
          throw createHttpError(
            'Repair job changed while diagnosis was being started. Refresh and try again.',
            409,
            'STATE_CONFLICT'
          );
        }
        job = updatedJob;
        started = true;
      } else if (job.diagnosisState !== 'Diagnosing') {
        const syncedJob = await repairJobRepository.syncDiagnosisStartedMetadata(
          job._id,
          actor._id,
          job.revision || 0,
          startedAt,
          session
        );
        if (!syncedJob) {
          throw createHttpError(
            'Repair job changed while diagnosis metadata was being prepared. Refresh and try again.',
            409,
            'STATE_CONFLICT'
          );
        }
        job = syncedJob;
      }

      diagnosis = await diagnosisRepository.startForJob({
        jobId: job._id,
        technicianId: actor._id,
        startedAt
      }, session);

      result = {
        started,
        message: started
          ? 'Diagnosis started successfully'
          : 'Diagnosis is already in progress',
        job: serializeJobState(job),
        diagnosis: serializeTechnicianDiagnosis(diagnosis)
      };
    });
  } catch (error) {
    if (transactionUnavailable(error)) {
      throw createHttpError(
        'Diagnosis state changes require MongoDB transaction support. Use MongoDB Atlas or a replica-set deployment.',
        503,
        'TRANSACTION_REQUIRED'
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return result;
};

const buildDraftSet = (payload = {}, actorId) => {
  const set = { lastUpdatedBy: actorId };
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(payload, 'findings')) {
    set.findings = normalizeText(payload.findings, 'Diagnosis findings', 4000);
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'recommendedWork')) {
    set.recommendedWork = normalizeText(payload.recommendedWork, 'Recommended work', 4000);
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'publicSummary')) {
    set.publicSummary = normalizeText(payload.publicSummary, 'Customer-safe summary', 2000);
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'internalNotes')) {
    set.internalNotes = normalizeText(payload.internalNotes, 'Internal notes', 4000);
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'isUnrepairable')) {
    if (typeof payload.isUnrepairable !== 'boolean') {
      throw createHttpError('isUnrepairable must be true or false', 400, 'VALIDATION_ERROR');
    }
    set.isUnrepairable = payload.isUnrepairable;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'unrepairableReason')) {
    set.unrepairableReason = normalizeText(
      payload.unrepairableReason,
      'Unrepairable reason',
      1000
    ) || null;
    changed = true;
  }

  if (set.isUnrepairable === false) {
    set.unrepairableReason = null;
  }

  return { set, changed };
};

const mergeDiagnosisValues = (diagnosis, set) => ({
  findings: Object.prototype.hasOwnProperty.call(set, 'findings')
    ? set.findings
    : diagnosis.findings || '',
  recommendedWork: Object.prototype.hasOwnProperty.call(set, 'recommendedWork')
    ? set.recommendedWork
    : diagnosis.recommendedWork || '',
  publicSummary: Object.prototype.hasOwnProperty.call(set, 'publicSummary')
    ? set.publicSummary
    : diagnosis.publicSummary || '',
  internalNotes: Object.prototype.hasOwnProperty.call(set, 'internalNotes')
    ? set.internalNotes
    : diagnosis.internalNotes || '',
  isUnrepairable: Object.prototype.hasOwnProperty.call(set, 'isUnrepairable')
    ? set.isUnrepairable
    : Boolean(diagnosis.isUnrepairable),
  unrepairableReason: Object.prototype.hasOwnProperty.call(set, 'unrepairableReason')
    ? set.unrepairableReason
    : diagnosis.unrepairableReason || null
});

const validateCompletion = (values) => {
  const findings = normalizeText(values.findings, 'Diagnosis findings', 4000, { required: true });
  const recommendedWork = normalizeText(
    values.recommendedWork,
    'Recommended work',
    4000,
    { required: true }
  );
  const publicSummary = normalizeText(
    values.publicSummary,
    'Customer-safe summary',
    2000,
    { required: true }
  );
  const internalNotes = normalizeText(values.internalNotes, 'Internal notes', 4000);
  const isUnrepairable = Boolean(values.isUnrepairable);
  const unrepairableReason = normalizeText(
    values.unrepairableReason,
    'Unrepairable reason',
    1000,
    { required: isUnrepairable }
  ) || null;

  return {
    findings,
    recommendedWork,
    publicSummary,
    internalNotes,
    isUnrepairable,
    unrepairableReason
  };
};

const saveDiagnosis = async ({ jobIdentifier, payload = {}, actor }) => {
  const completeRequested = payload.complete === true;
  if (Object.prototype.hasOwnProperty.call(payload, 'complete') && typeof payload.complete !== 'boolean') {
    throw createHttpError('complete must be true or false', 400, 'VALIDATION_ERROR');
  }

  if (!completeRequested) {
    const job = await loadAssignedJob(jobIdentifier, actor);
    if (job.status !== 'Diagnosing') {
      throw createHttpError(
        `Diagnosis cannot be edited when the job status is ${job.status}`,
        409,
        'STATE_CONFLICT'
      );
    }

    const diagnosis = await diagnosisRepository.findByJob(job._id);
    if (!diagnosis) {
      throw createHttpError('Start diagnosis before saving findings', 409, 'STATE_CONFLICT');
    }
    if (diagnosis.completedAt || diagnosis.isCompleted || diagnosis.diagnosisCompleted) {
      throw createHttpError(
        'Completed diagnosis records cannot be overwritten',
        409,
        'STATE_CONFLICT'
      );
    }

    const { set, changed } = buildDraftSet(payload, actor._id);
    if (!changed) {
      throw createHttpError('Provide at least one diagnosis field to save', 400, 'VALIDATION_ERROR');
    }

    const updated = await diagnosisRepository.saveDraft(job._id, set);
    if (!updated) {
      throw createHttpError(
        'Diagnosis changed while it was being saved. Refresh and try again.',
        409,
        'STATE_CONFLICT'
      );
    }

    return {
      completed: false,
      message: 'Diagnosis draft saved successfully',
      job: serializeJobState(job),
      diagnosis: serializeTechnicianDiagnosis(updated)
    };
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      let job = await loadAssignedJob(jobIdentifier, actor, { session });
      if (job.status !== 'Diagnosing') {
        throw createHttpError(
          `Diagnosis cannot be completed when the job status is ${job.status}`,
          409,
          'STATE_CONFLICT'
        );
      }

      const diagnosis = await diagnosisRepository.findByJob(job._id, { session });
      if (!diagnosis) {
        throw createHttpError('Start diagnosis before completing it', 409, 'STATE_CONFLICT');
      }

      if (diagnosis.completedAt || diagnosis.isCompleted || diagnosis.diagnosisCompleted) {
        result = {
          completed: true,
          idempotentReplay: true,
          message: 'Diagnosis has already been recorded',
          job: serializeJobState(job),
          diagnosis: serializeTechnicianDiagnosis(diagnosis)
        };
        return;
      }

      const { set } = buildDraftSet(payload, actor._id);
      const finalValues = validateCompletion(mergeDiagnosisValues(diagnosis, set));
      const completedAt = new Date();

      const updatedDiagnosis = await diagnosisRepository.complete(
        job._id,
        {
          ...finalValues,
          lastUpdatedBy: actor._id,
          completedAt,
          completedBy: actor._id
        },
        session
      );

      if (!updatedDiagnosis) {
        throw createHttpError(
          'Diagnosis changed while completion was being saved. Refresh and try again.',
          409,
          'STATE_CONFLICT'
        );
      }

      const updatedJob = await repairJobRepository.markDiagnosisRecorded(
        job._id,
        actor._id,
        job.revision || 0,
        completedAt,
        session
      );

      if (!updatedJob) {
        throw createHttpError(
          'Repair job changed while diagnosis completion was being recorded. Refresh and try again.',
          409,
          'STATE_CONFLICT'
        );
      }

      job = updatedJob;
      result = {
        completed: true,
        idempotentReplay: false,
        // RepairJob.status intentionally remains Diagnosing. Existing SCRUM-14
        // estimate issuance requires that status; diagnosisState carries the
        // second transition without breaking previously completed work.
        message: 'Diagnosis recorded successfully',
        job: serializeJobState(job),
        diagnosis: serializeTechnicianDiagnosis(updatedDiagnosis)
      };
    });
  } catch (error) {
    if (transactionUnavailable(error)) {
      throw createHttpError(
        'Completing a diagnosis requires MongoDB transaction support. Use MongoDB Atlas or a replica-set deployment.',
        503,
        'TRANSACTION_REQUIRED'
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return result;
};

const getStaffDiagnosis = async ({ jobIdentifier, actor }) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can view internal diagnosis details', 403, 'FORBIDDEN');
  }

  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);
  if (!job) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  const diagnosis = await diagnosisRepository.findByJob(job._id);
  return {
    job: serializeJobState(job),
    diagnosis: serializeStaffDiagnosis(diagnosis)
  };
};

const getCustomerDiagnosis = async ({ jobIdentifier, actor }) => {
  if (!actor || actor.role !== 'customer') {
    throw createHttpError('Only customers can view this diagnosis summary', 403, 'FORBIDDEN');
  }

  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);
  // Missing and cross-customer jobs intentionally return the same response to
  // avoid leaking whether another customer's repair reference exists.
  if (!job || !sameId(job.customer, actor._id)) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  const diagnosis = await diagnosisRepository.findCompletedByJob(job._id);
  return {
    job: {
      id: job._id,
      reference: job.reference,
      status: job.status
    },
    hasDiagnosis: Boolean(diagnosis),
    diagnosis: serializePublicDiagnosis(diagnosis)
  };
};

module.exports = {
  getTechnicianDiagnosis,
  startDiagnosis,
  saveDiagnosis,
  getStaffDiagnosis,
  getCustomerDiagnosis,
  serializePublicDiagnosis
};
