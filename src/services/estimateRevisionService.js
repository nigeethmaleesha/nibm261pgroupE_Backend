const crypto = require('crypto');
const mongoose = require('mongoose');
const estimateRepository = require('../repositories/estimateRepository');
const estimateRevisionDraftRepository = require('../repositories/estimateRevisionDraftRepository');
const repairJobRepository = require('../repositories/repairJobRepository');
const { normalizeItems, serializeEstimate } = require('./estimateService');
const { revisionEligibilityFor, getWorkAuthorisation } = require('./repairAuthorisationService');
const { formatMinor } = require('../utils/money');

/*
 * Estimate revision: Owner/Staff issues a new sequential estimate version when
 * the work or cost changes. Issued versions stay immutable; the new version
 * becomes the job's currentEstimate and the job returns to Awaiting Approval.
 * Drafts are stored separately and never replace the current estimate.
 */

const createHttpError = (message, statusCode, code, details) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.codeName = code;
  if (details) error.details = details;
  return error;
};

const assertOwnerStaff = (actor) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can revise repair estimates', 403, 'FORBIDDEN');
  }
};

const normalizeChangeReason = (value, { required }) => {
  const changeReason = String(value ?? '').trim();

  if (!changeReason) {
    if (required) {
      throw createHttpError(
        'changeReason is required when issuing a revised estimate',
        422,
        'VALIDATION_ERROR'
      );
    }
    return null;
  }

  if (changeReason.length > 1000) {
    throw createHttpError(
      'changeReason must not exceed 1000 characters',
      422,
      'VALIDATION_ERROR'
    );
  }

  return changeReason;
};

const normalizeBaseVersion = (value) => {
  if (value === undefined || value === null || value === '') return null;

  const baseVersionNumber = Number(value);
  if (!Number.isSafeInteger(baseVersionNumber) || baseVersionNumber < 1) {
    throw createHttpError(
      'baseVersionNumber must be a positive whole number',
      422,
      'VALIDATION_ERROR'
    );
  }
  return baseVersionNumber;
};

const hashRevisionRequest = ({ items, totalMinor }, changeReason, baseVersionNumber) => crypto
  .createHash('sha256')
  .update(JSON.stringify({ items, totalMinor, currency: 'LKR', changeReason, baseVersionNumber }))
  .digest('hex');

const sameLines = (normalizedItems, savedItems) => (
  normalizedItems.length === savedItems.length &&
  normalizedItems.every((item, index) => {
    const saved = savedItems[index];
    return item.type === saved.type &&
      item.description === saved.description &&
      item.quantity === saved.quantity &&
      item.unitPriceMinor === saved.unitPriceMinor;
  })
);

const isTransactionUnsupported = (error) => (
  /Transaction numbers are only allowed|replica set member|mongos/i.test(error?.message || '')
);

const loadJob = async (jobIdentifier, options) => {
  const job = await repairJobRepository.findByIdOrReference(jobIdentifier, options);
  if (!job) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }
  return job;
};

const serializeJobSummary = (job) => ({
  id: job._id,
  reference: job.reference,
  status: job.status,
  revision: job.revision || 0,
  partsHold: {
    active: Boolean(job.partsHold?.active),
    reason: job.partsHold?.reason || null,
    placedAt: job.partsHold?.placedAt || null
  }
});

const serializeDraft = (draft, currentEstimate) => {
  if (!draft) return null;

  const currentVersionNumber = currentEstimate ? currentEstimate.versionNumber : null;
  return {
    id: draft._id,
    status: 'Draft',
    baseEstimateId: draft.baseEstimate,
    baseVersionNumber: draft.baseVersionNumber,
    // A draft prepared against an older version must be re-saved before issue.
    isStale: currentVersionNumber !== draft.baseVersionNumber,
    replacesCurrentEstimate: false,
    authorisesWork: false,
    changeReason: draft.changeReason || null,
    currency: draft.currency,
    totalMinor: draft.totalMinor,
    total: formatMinor(draft.totalMinor),
    items: draft.items.map((item) => ({
      lineNumber: item.lineNumber,
      type: item.type,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      unitPrice: formatMinor(item.unitPriceMinor),
      lineTotalMinor: item.lineTotalMinor,
      lineTotal: formatMinor(item.lineTotalMinor)
    })),
    createdBy: draft.createdBy,
    updatedBy: draft.updatedBy,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
};

const getEstimateHistory = async ({ jobIdentifier, actor }) => {
  assertOwnerStaff(actor);

  const job = await loadJob(jobIdentifier);
  const [estimates, draft] = await Promise.all([
    estimateRepository.listByJob(job._id),
    estimateRevisionDraftRepository.findByJob(job._id)
  ]);

  const currentId = job.currentEstimate
    ? String(job.currentEstimate)
    : (estimates[0] ? String(estimates[0]._id) : null);
  const currentEstimate = estimates.find((estimate) => String(estimate._id) === currentId) || null;

  const versions = await Promise.all(estimates.map(async (estimate) => ({
    ...(await serializeEstimate(estimate)),
    isCurrent: String(estimate._id) === currentId
  })));

  return {
    job: serializeJobSummary(job),
    currentVersionNumber: currentEstimate ? currentEstimate.versionNumber : null,
    revisionEligibility: revisionEligibilityFor(job, currentEstimate),
    workAuthorisation: getWorkAuthorisation(job, currentEstimate),
    draftRevision: serializeDraft(draft, currentEstimate),
    versions
  };
};

const getRevisionDraft = async ({ jobIdentifier, actor }) => {
  assertOwnerStaff(actor);

  const job = await loadJob(jobIdentifier);
  const [draft, currentEstimate] = await Promise.all([
    estimateRevisionDraftRepository.findByJob(job._id),
    estimateRepository.findCurrentByJob(job)
  ]);

  if (!draft) {
    throw createHttpError('No revision draft exists for this repair job', 404, 'NOT_FOUND');
  }

  return {
    job: serializeJobSummary(job),
    currentVersionNumber: currentEstimate ? currentEstimate.versionNumber : null,
    draft: serializeDraft(draft, currentEstimate)
  };
};

const saveRevisionDraft = async ({ jobIdentifier, payload = {}, actor }) => {
  assertOwnerStaff(actor);

  // Drafts use the same line/amount validation as issued estimates. The change
  // reason may be completed later, but is enforced when the draft is issued.
  const normalized = normalizeItems(payload);
  const changeReason = normalizeChangeReason(payload.changeReason, { required: false });

  const job = await loadJob(jobIdentifier);
  const currentEstimate = await estimateRepository.findCurrentByJob(job);
  const eligibility = revisionEligibilityFor(job, currentEstimate);
  if (!eligibility.eligible) {
    throw createHttpError(eligibility.reasons[0], 409, 'STATE_CONFLICT', eligibility.reasons);
  }

  const draft = await estimateRevisionDraftRepository.upsertForJob(job._id, {
    baseEstimate: currentEstimate._id,
    baseVersionNumber: currentEstimate.versionNumber,
    changeReason,
    items: normalized.items,
    totalMinor: normalized.totalMinor,
    actorId: actor._id
  });

  return {
    saved: true,
    message: 'Revision draft saved. It has not been issued and does not replace the current estimate.',
    job: serializeJobSummary(job),
    currentVersionNumber: currentEstimate.versionNumber,
    draft: serializeDraft(draft, currentEstimate)
  };
};

const discardRevisionDraft = async ({ jobIdentifier, actor }) => {
  assertOwnerStaff(actor);

  const job = await loadJob(jobIdentifier);
  const result = await estimateRevisionDraftRepository.deleteByJob(job._id);
  if (!result.deletedCount) {
    throw createHttpError('No revision draft exists for this repair job', 404, 'NOT_FOUND');
  }

  return {
    discarded: true,
    message: 'Revision draft discarded. The current estimate is unchanged.'
  };
};

// Builds the issue request from the body, or from the saved draft when
// `useDraft: true` is sent. Body values override the draft change reason.
const resolveIssueSource = async (job, payload) => {
  if (payload.useDraft !== true) {
    return {
      source: payload,
      baseVersionNumber: normalizeBaseVersion(payload.baseVersionNumber)
    };
  }

  const draft = await estimateRevisionDraftRepository.findByJob(job._id);
  if (!draft) {
    throw createHttpError('No revision draft exists for this repair job', 404, 'NOT_FOUND');
  }

  return {
    source: {
      items: draft.items.map((item) => ({
        type: item.type,
        description: item.description,
        quantity: item.quantity,
        unitPrice: formatMinor(item.unitPriceMinor)
      })),
      changeReason: payload.changeReason ?? draft.changeReason
    },
    baseVersionNumber: draft.baseVersionNumber
  };
};

const buildIssueResult = async ({ created, estimate, previousEstimate, job, session = null }) => ({
  created,
  idempotentReplay: !created,
  message: created
    ? `Revised estimate version ${estimate.versionNumber} issued. The customer must authorise it before repair work continues.`
    : `This revision was already issued. Returning the immutable version ${estimate.versionNumber}.`,
  estimate: await serializeEstimate(estimate, { session }),
  previousEstimate: previousEstimate ? {
    id: previousEstimate._id,
    versionNumber: previousEstimate.versionNumber,
    status: previousEstimate.status,
    decision: previousEstimate.decision?.action ? {
      action: previousEstimate.decision.action,
      decidedBy: previousEstimate.decision.decidedBy,
      decidedAt: previousEstimate.decision.decidedAt
    } : null
  } : null,
  job: serializeJobSummary(job),
  jobStatus: job.status,
  workAuthorisation: getWorkAuthorisation(job, estimate)
});

const issueRevisedEstimate = async ({ jobIdentifier, payload = {}, actor }) => {
  assertOwnerStaff(actor);

  const preflightJob = await loadJob(jobIdentifier);
  const { source, baseVersionNumber } = await resolveIssueSource(preflightJob, payload);

  // Same amount-validation rules as the initial estimate, plus a required reason.
  const normalized = normalizeItems(source);
  const changeReason = normalizeChangeReason(source.changeReason, { required: true });

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const job = await repairJobRepository.findByIdForEstimate(preflightJob._id, { session });
      if (!job) {
        throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
      }

      const currentEstimate = await estimateRepository.findCurrentByJob(
        job,
        { includeRequestHash: true, session }
      );
      const eligibility = revisionEligibilityFor(job, currentEstimate);
      if (!currentEstimate) {
        throw createHttpError(eligibility.reasons[0], 409, 'STATE_CONFLICT', eligibility.reasons);
      }

      const currentItems = await estimateRepository.listItems(currentEstimate._id, { session });
      const linesUnchanged = sameLines(normalized.items, currentItems);

      // Safe retry: the same revision (lines + reason) is already the current
      // version, so return it instead of issuing a duplicate version.
      if (
        linesUnchanged &&
        currentEstimate.versionNumber > 1 &&
        currentEstimate.changeReason === changeReason &&
        (baseVersionNumber === null || baseVersionNumber === currentEstimate.versionNumber - 1)
      ) {
        const previousEstimate = await estimateRepository.findById(
          currentEstimate.basedOnEstimate,
          { session }
        );
        result = await buildIssueResult({
          created: false,
          estimate: currentEstimate,
          previousEstimate,
          job,
          session
        });
        return;
      }

      if (baseVersionNumber !== null && baseVersionNumber !== currentEstimate.versionNumber) {
        throw createHttpError(
          `The revision was prepared against version ${baseVersionNumber}, but the current estimate is version ${currentEstimate.versionNumber}. Refresh and review the latest estimate.`,
          409,
          'STATE_CONFLICT'
        );
      }

      if (!eligibility.eligible) {
        throw createHttpError(eligibility.reasons[0], 409, 'STATE_CONFLICT', eligibility.reasons);
      }

      if (linesUnchanged) {
        throw createHttpError(
          'A revised estimate must change the work or cost of the current estimate',
          422,
          'VALIDATION_ERROR'
        );
      }

      const issuedAt = new Date();
      const versionNumber = currentEstimate.versionNumber + 1;
      const estimate = await estimateRepository.createEstimate({
        job: job._id,
        versionNumber,
        changeReason,
        basedOnEstimate: currentEstimate._id,
        currency: 'LKR',
        totalMinor: normalized.totalMinor,
        createdBy: actor._id,
        issuedBy: actor._id,
        issuedAt,
        isImmutable: true,
        requestHash: hashRevisionRequest(normalized, changeReason, currentEstimate.versionNumber)
      }, session);

      await estimateRepository.createItems(normalized.items.map((item) => ({
        ...item,
        estimate: estimate._id,
        isImmutable: true
      })), session);

      await estimateRepository.markSuperseded(
        currentEstimate._id,
        { supersededBy: estimate._id, supersededAt: issuedAt },
        session
      );

      // Waiting for Parts is replaced by Awaiting Approval, so record the parts
      // hold on the job to keep it active. An existing hold is left untouched.
      const partsHold = job.status === 'Waiting for Parts' && !job.partsHold?.active
        ? {
          active: true,
          reason: 'Parts were awaited when the estimate was revised',
          placedAt: issuedAt,
          releasedAt: null
        }
        : null;

      const updatedJob = await repairJobRepository.attachRevisedEstimate(
        job._id,
        {
          previousEstimateId: currentEstimate._id,
          estimateId: estimate._id,
          expectedStatus: job.status,
          expectedRevision: job.revision || 0,
          partsHold
        },
        session
      );

      if (!updatedJob) {
        throw createHttpError(
          'Repair job changed while the revision was being issued. Refresh and try again.',
          409,
          'STATE_CONFLICT'
        );
      }

      // The draft has been issued, so it no longer represents pending work.
      await estimateRevisionDraftRepository.deleteByJob(job._id, session);

      const previousEstimate = await estimateRepository.findById(currentEstimate._id, { session });
      result = await buildIssueResult({
        created: true,
        estimate,
        previousEstimate,
        job: updatedJob,
        session
      });
    });

    return result;
  } catch (error) {
    // Two revisions raced for the same version number; the other one won.
    if (error?.code === 11000) {
      throw createHttpError(
        'Another estimate revision was issued at the same time. Refresh and review the latest estimate.',
        409,
        'STATE_CONFLICT'
      );
    }

    if (isTransactionUnsupported(error)) {
      throw createHttpError(
        'Estimate revisions require MongoDB transaction support. Use MongoDB Atlas or a replica-set deployment.',
        503,
        'TRANSACTION_REQUIRED'
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  getEstimateHistory,
  getRevisionDraft,
  saveRevisionDraft,
  discardRevisionDraft,
  issueRevisedEstimate
};
