const crypto = require('crypto');
const mongoose = require('mongoose');
const estimateRepository = require('../repositories/estimateRepository');
const repairJobRepository = require('../repositories/repairJobRepository');
const diagnosisRepository = require('../repositories/diagnosisCompatibilityRepository');
const estimateRevisionDraftRepository = require('../repositories/estimateRevisionDraftRepository');
const { revisionEligibilityFor, getWorkAuthorisation } = require('./repairAuthorisationService');
const { parseLkrToMinor, multiplyMinor, sumMinor, formatMinor } = require('../utils/money');

const createHttpError = (message, statusCode, code, details) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.codeName = code;
  if (details) error.details = details;
  return error;
};

const normalizeType = (value, index) => {
  const type = String(value || '').trim().toUpperCase();
  if (!['PART', 'LABOUR'].includes(type)) {
    throw createHttpError(
      `items[${index}].type must be PART or LABOUR`,
      422,
      'VALIDATION_ERROR'
    );
  }
  return type;
};

const normalizeDescription = (value, index) => {
  const description = String(value || '').trim();
  if (!description) {
    throw createHttpError(
      `items[${index}].description is required`,
      422,
      'VALIDATION_ERROR'
    );
  }
  if (description.length > 500) {
    throw createHttpError(
      `items[${index}].description must not exceed 500 characters`,
      422,
      'VALIDATION_ERROR'
    );
  }
  return description;
};

const normalizeQuantity = (value, index) => {
  const quantity = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw createHttpError(
      `items[${index}].quantity must be a positive whole number`,
      422,
      'VALIDATION_ERROR'
    );
  }
  return quantity;
};

const normalizeItems = (payload = {}) => {
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw createHttpError(
      'At least one parts or labour line is required',
      422,
      'VALIDATION_ERROR'
    );
  }

  if (payload.items.length > 100) {
    throw createHttpError(
      'An estimate cannot contain more than 100 line items',
      422,
      'VALIDATION_ERROR'
    );
  }

  const items = payload.items.map((item, index) => {
    const type = normalizeType(item?.type, index);
    const description = normalizeDescription(item?.description, index);
    const quantity = normalizeQuantity(item?.quantity, index);
    const unitPriceMinor = parseLkrToMinor(item?.unitPrice, `items[${index}].unitPrice`);
    const lineTotalMinor = multiplyMinor(quantity, unitPriceMinor);

    return {
      lineNumber: index + 1,
      type,
      description,
      quantity,
      unitPriceMinor,
      lineTotalMinor
    };
  });

  const totalMinor = sumMinor(items.map((item) => item.lineTotalMinor));
  if (totalMinor <= 0) {
    throw createHttpError(
      'Estimate total must exceed LKR 0.00',
      422,
      'VALIDATION_ERROR'
    );
  }

  return { items, totalMinor };
};

const hashEstimateRequest = ({ items, totalMinor }) => crypto
  .createHash('sha256')
  .update(JSON.stringify({ items, totalMinor, currency: 'LKR' }))
  .digest('hex');

const serializeItem = (item) => ({
  id: item._id,
  lineNumber: item.lineNumber,
  type: item.type,
  description: item.description,
  quantity: item.quantity,
  unitPriceMinor: item.unitPriceMinor,
  unitPrice: formatMinor(item.unitPriceMinor),
  lineTotalMinor: item.lineTotalMinor,
  lineTotal: formatMinor(item.lineTotalMinor)
});

const serializeEstimate = async (estimate, { session = null } = {}) => {
  const items = await estimateRepository.listItems(estimate._id, { session });
  return {
    id: estimate._id,
    jobId: estimate.job,
    versionNumber: estimate.versionNumber,
    currency: estimate.currency,
    totalMinor: estimate.totalMinor,
    total: formatMinor(estimate.totalMinor),
    status: estimate.status || 'Issued',
    changeReason: estimate.changeReason || null,
    basedOnEstimateId: estimate.basedOnEstimate || null,
    supersededBy: estimate.supersededBy || null,
    supersededAt: estimate.supersededAt || null,
    issuedBy: estimate.issuedBy,
    issuedAt: estimate.issuedAt,
    isImmutable: estimate.isImmutable,
    decision: estimate.decision && estimate.decision.action ? {
      action: estimate.decision.action,
      decidedBy: estimate.decision.decidedBy,
      decidedAt: estimate.decision.decidedAt
    } : null,
    items: items.map(serializeItem)
  };
};

const eligibilityFor = (job, diagnosis, existingEstimate) => {
  const reasons = [];

  if (job.status !== 'Diagnosing') {
    reasons.push(`Job must be Diagnosing before the initial estimate can be issued (current: ${job.status})`);
  }
  if (!diagnosis) {
    reasons.push('A completed diagnosis is required before the initial estimate can be issued');
  }
  if (existingEstimate || job.currentEstimate) {
    reasons.push('An initial estimate has already been issued for this repair job');
  }

  return {
    eligible: reasons.length === 0,
    reasons
  };
};

const getEstimateContext = async ({ jobIdentifier, actor }) => {
  if (!actor || !['owner_staff', 'customer'].includes(actor.role)) {
    throw createHttpError('Only Owner/Staff or customer can access estimate details', 403, 'FORBIDDEN');
  }

  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);
  if (!job) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  if (actor.role === 'customer' && job.customer.toString() !== actor._id.toString()) {
    throw createHttpError('You are not authorized to view this repair job estimate', 403, 'FORBIDDEN');
  }

  const [diagnosis, existingEstimate, latestEstimate, revisionDraft] = await Promise.all([
    diagnosisRepository.findCompletedByJob(job._id),
    estimateRepository.findInitialByJob(job._id),
    estimateRepository.findCurrentByJob(job),
    estimateRevisionDraftRepository.findByJob(job._id)
  ]);

  const eligibility = eligibilityFor(job, diagnosis, existingEstimate);
  const currentEstimate = latestEstimate
    ? await serializeEstimate(latestEstimate)
    : null;

  return {
    job: {
      id: job._id,
      reference: job.reference,
      status: job.status,
      revision: job.revision || 0,
      deviceType: job.deviceType,
      makeModel: job.makeModel,
      serialNumber: job.serialNumber || null,
      reportedFault: job.reportedFault,
      receivedAt: job.receivedAt,
      customer: {
        id: job.customer,
        fullName: job.customerSnapshot.fullName,
        email: job.customerSnapshot.email,
        contactNumber: job.customerSnapshot.contactNumber
      }
    },
    diagnosis: diagnosisRepository.serializeForStaff(diagnosis),
    eligibility,
    revisionEligibility: revisionEligibilityFor(job, latestEstimate),
    hasRevisionDraft: Boolean(revisionDraft),
    workAuthorisation: getWorkAuthorisation(job, latestEstimate),
    currentEstimate
  };
};

// jobStatus is the job's real status: after a revision or a customer decision
// the job is no longer Awaiting Approval for version 1.
const ensureExistingMatches = async (existingEstimate, requestHash, jobStatus) => {
  const withHash = existingEstimate.requestHash
    ? existingEstimate
    : await estimateRepository.findInitialByJob(existingEstimate.job, { includeRequestHash: true });

  if (withHash.requestHash !== requestHash) {
    throw createHttpError(
      'Version 1 has already been issued. Issued estimates are immutable; later changes require a new version.',
      409,
      'STATE_CONFLICT'
    );
  }

  return {
    created: false,
    idempotentReplay: true,
    message: 'This estimate was already issued. Returning the immutable version 1.',
    estimate: await serializeEstimate(withHash),
    jobStatus
  };
};

const issueInitialEstimate = async ({ jobIdentifier, payload, actor }) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can issue repair estimates', 403, 'FORBIDDEN');
  }

  // Validate money/quantity rules before state checks so field errors remain
  // deterministic even while predecessor stories are being integrated.
  const normalized = normalizeItems(payload);
  const requestHash = hashEstimateRequest(normalized);

  const preflightJob = await repairJobRepository.findByIdOrReference(jobIdentifier);
  if (!preflightJob) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  const preflightExisting = await estimateRepository.findInitialByJob(
    preflightJob._id,
    { includeRequestHash: true }
  );
  if (preflightExisting) {
    return ensureExistingMatches(preflightExisting, requestHash, preflightJob.status);
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const job = await repairJobRepository.findByIdForEstimate(preflightJob._id, { session });
      if (!job) {
        throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
      }

      const existingEstimate = await estimateRepository.findInitialByJob(
        job._id,
        { includeRequestHash: true, session }
      );
      if (existingEstimate) {
        result = await ensureExistingMatches(existingEstimate, requestHash, job.status);
        return;
      }

      const diagnosis = await diagnosisRepository.findCompletedByJob(job._id, session);
      const eligibility = eligibilityFor(job, diagnosis, existingEstimate);
      if (!eligibility.eligible) {
        throw createHttpError(
          eligibility.reasons[0],
          409,
          'STATE_CONFLICT',
          eligibility.reasons
        );
      }

      const issuedAt = new Date();
      const estimate = await estimateRepository.createEstimate({
        job: job._id,
        versionNumber: 1,
        changeReason: null,
        currency: 'LKR',
        totalMinor: normalized.totalMinor,
        createdBy: actor._id,
        issuedBy: actor._id,
        issuedAt,
        isImmutable: true,
        requestHash
      }, session);

      const estimateItems = normalized.items.map((item) => ({
        ...item,
        estimate: estimate._id,
        isImmutable: true
      }));
      await estimateRepository.createItems(estimateItems, session);

      const updatedJob = await repairJobRepository.attachInitialEstimate(
        job._id,
        estimate._id,
        job.revision || 0,
        session
      );

      if (!updatedJob) {
        throw createHttpError(
          'Repair job changed while the estimate was being issued. Refresh and try again.',
          409,
          'STATE_CONFLICT'
        );
      }

      result = {
        created: true,
        idempotentReplay: false,
        message: 'Repair estimate version 1 issued successfully',
        estimate: await serializeEstimate(estimate, { session }),
        jobStatus: updatedJob.status
      };
    });

    return result;
  } catch (error) {
    // A concurrent identical issue can lose the unique (job, version) race after
    // the other transaction commits. Re-read version 1 and apply the same
    // immutable replay/change detection contract.
    if (error?.code === 11000) {
      const concurrentEstimate = await estimateRepository.findInitialByJob(
        preflightJob._id,
        { includeRequestHash: true }
      );
      if (concurrentEstimate) {
        const latestJob = await repairJobRepository.findByIdForEstimate(preflightJob._id);
        return ensureExistingMatches(
          concurrentEstimate,
          requestHash,
          latestJob ? latestJob.status : preflightJob.status
        );
      }
    }

    if (
      /Transaction numbers are only allowed|replica set member|mongos/i.test(error?.message || '')
    ) {
      throw createHttpError(
        'Estimate issuing requires MongoDB transaction support. Use MongoDB Atlas or a replica-set deployment.',
        503,
        'TRANSACTION_REQUIRED'
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

const recordEstimateDecision = async ({ jobIdentifier, payload = {}, actor }) => {
  if (!actor || actor.role !== 'customer') {
    throw createHttpError('Only customers can authorize or reject repair estimates', 403, 'FORBIDDEN');
  }

  const rawAction = String(payload.action || payload.decision || '').trim().toUpperCase();
  let normalizedAction;
  if (['APPROVE', 'APPROVED'].includes(rawAction)) {
    normalizedAction = 'APPROVED';
  } else if (['REJECT', 'REJECTED'].includes(rawAction)) {
    normalizedAction = 'REJECTED';
  } else {
    throw createHttpError(
      'action must be APPROVE or REJECT',
      422,
      'VALIDATION_ERROR'
    );
  }

  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);
  if (!job) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  if (job.customer.toString() !== actor._id.toString()) {
    throw createHttpError(
      'You are not authorized to make an estimate decision for this repair job',
      403,
      'FORBIDDEN'
    );
  }

  // Decisions always apply to the latest issued version. Earlier versions that
  // were replaced by a revision can no longer be approved or rejected.
  const currentEstimate = await estimateRepository.findCurrentByJob(job);
  if (!currentEstimate) {
    throw createHttpError('No issued estimate found for this repair job', 404, 'NOT_FOUND');
  }

  // Idempotency check: If an identical decision was already recorded by the same customer on this estimate
  if (currentEstimate.decision && currentEstimate.decision.action) {
    const existingAction = currentEstimate.decision.action;
    const existingUser = currentEstimate.decision.decidedBy
      ? currentEstimate.decision.decidedBy.toString()
      : null;

    if (existingAction === normalizedAction && existingUser === actor._id.toString()) {
      return {
        created: false,
        idempotentReplay: true,
        message: 'Estimate decision has already been recorded.',
        jobStatus: job.status,
        estimateStatus: currentEstimate.status,
        decision: {
          action: currentEstimate.decision.action,
          decidedBy: currentEstimate.decision.decidedBy,
          decidedAt: currentEstimate.decision.decidedAt,
          versionNumber: currentEstimate.versionNumber
        },
        estimate: await serializeEstimate(currentEstimate)
      };
    }

    throw createHttpError(
      'This estimate has already been decided or superseded. Please refresh to view current status.',
      409,
      'STATE_CONFLICT'
    );
  }

  // Stale state check: Job must be in 'Awaiting Approval'
  if (job.status !== 'Awaiting Approval') {
    throw createHttpError(
      `Job is no longer awaiting estimate approval (current status: ${job.status}). Please refresh.`,
      409,
      'STATE_CONFLICT'
    );
  }

  // Stale version check if client passed versionNumber
  if (payload.versionNumber !== undefined && payload.versionNumber !== null) {
    const reqVersion = Number(payload.versionNumber);
    if (!Number.isInteger(reqVersion) || reqVersion !== currentEstimate.versionNumber) {
      throw createHttpError(
        'The estimate version is stale. Please refresh and review the latest estimate.',
        409,
        'STATE_CONFLICT'
      );
    }
  }

  // Stale total check if client passed total or totalMinor
  if (payload.total !== undefined && payload.total !== null) {
    const reqTotalMinor = parseLkrToMinor(payload.total, 'total');
    if (reqTotalMinor !== currentEstimate.totalMinor) {
      throw createHttpError(
        'The estimate total is stale. Please refresh and review the latest estimate.',
        409,
        'STATE_CONFLICT'
      );
    }
  }

  const targetJobStatus = normalizedAction === 'APPROVED' ? 'Approved' : 'Estimate Rejected';
  const targetEstimateStatus = normalizedAction === 'APPROVED' ? 'Approved' : 'Rejected';
  const decidedAt = new Date();

  const session = await mongoose.startSession();
  try {
    let updatedEstimate;
    let updatedJob;

    await session.withTransaction(async () => {
      updatedEstimate = await estimateRepository.recordDecision(
        currentEstimate._id,
        {
          status: targetEstimateStatus,
          action: normalizedAction,
          decidedBy: actor._id,
          decidedAt
        },
        session
      );

      if (!updatedEstimate) {
        throw createHttpError(
          'This estimate has already been decided or updated. Please refresh.',
          409,
          'STATE_CONFLICT'
        );
      }

      updatedJob = await repairJobRepository.updateStatusForDecision(
        job._id,
        targetJobStatus,
        job.revision || 0,
        session
      );

      if (!updatedJob) {
        throw createHttpError(
          'Repair job state changed while recording your decision. Please refresh and try again.',
          409,
          'STATE_CONFLICT'
        );
      }
    });

    return {
      created: true,
      idempotentReplay: false,
      message: `Estimate ${normalizedAction === 'APPROVED' ? 'approved' : 'rejected'} successfully`,
      jobStatus: updatedJob.status,
      estimateStatus: updatedEstimate.status,
      decision: {
        action: updatedEstimate.decision.action,
        decidedBy: updatedEstimate.decision.decidedBy,
        decidedAt: updatedEstimate.decision.decidedAt,
        versionNumber: updatedEstimate.versionNumber
      },
      estimate: await serializeEstimate(updatedEstimate)
    };
  } catch (error) {
    if (
      /Transaction numbers are only allowed|replica set member|mongos/i.test(error?.message || '')
    ) {
      const updatedEstimate = await estimateRepository.recordDecision(
        currentEstimate._id,
        {
          status: targetEstimateStatus,
          action: normalizedAction,
          decidedBy: actor._id,
          decidedAt
        }
      );

      if (!updatedEstimate) {
        throw createHttpError(
          'This estimate has already been decided or updated. Please refresh.',
          409,
          'STATE_CONFLICT'
        );
      }

      const updatedJob = await repairJobRepository.updateStatusForDecision(
        job._id,
        targetJobStatus,
        job.revision || 0
      );

      if (!updatedJob) {
        throw createHttpError(
          'Repair job state changed while recording your decision. Please refresh and try again.',
          409,
          'STATE_CONFLICT'
        );
      }

      return {
        created: true,
        idempotentReplay: false,
        message: `Estimate ${normalizedAction === 'APPROVED' ? 'approved' : 'rejected'} successfully`,
        jobStatus: updatedJob.status,
        estimateStatus: updatedEstimate.status,
        decision: {
          action: updatedEstimate.decision.action,
          decidedBy: updatedEstimate.decision.decidedBy,
          decidedAt: updatedEstimate.decision.decidedAt,
          versionNumber: updatedEstimate.versionNumber
        },
        estimate: await serializeEstimate(updatedEstimate)
      };
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  getEstimateContext,
  issueInitialEstimate,
  recordEstimateDecision,
  normalizeItems,
  serializeEstimate
};
