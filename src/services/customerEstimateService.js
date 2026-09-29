const repairJobRepository = require('../repositories/repairJobRepository');
const customerEstimateRepository = require('../repositories/customerEstimateRepository');
const { formatMinor } = require('../utils/money');

const createHttpError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.codeName = code;
  return error;
};

const sameId = (left, right) => (
  Boolean(left) && Boolean(right) && String(left) === String(right)
);

const serializePublicJob = (job) => ({
  id: job._id,
  reference: job.reference,
  status: job.status,
  deviceType: job.deviceType,
  makeModel: job.makeModel,
  serialNumber: job.serialNumber || null,
  receivedAt: job.receivedAt
});

const serializePublicItem = (item) => ({
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

const getDecisionState = ({ estimate, isLatest, canDecide }) => {
  if (!isLatest) return 'SUPERSEDED';
  if (estimate.decision?.action === 'APPROVED' || estimate.status === 'Approved') {
    return 'APPROVED';
  }
  if (estimate.decision?.action === 'REJECTED' || estimate.status === 'Rejected') {
    return 'REJECTED';
  }
  if (canDecide) return 'AWAITING_APPROVAL';
  return 'ISSUED';
};

const getCurrentEstimate = async ({ jobIdentifier, actor }) => {
  if (!actor || actor.role !== 'customer') {
    throw createHttpError('Only customers can view this estimate', 403, 'FORBIDDEN');
  }

  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);

  // Return the same not-found response for a missing job and a job owned by
  // another customer. This prevents customer-to-customer record disclosure.
  if (!job || !sameId(job.customer, actor._id)) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  const estimate = await customerEstimateRepository.findLatestIssuedByJob(job._id);
  const publicJob = serializePublicJob(job);

  if (!estimate) {
    return {
      job: publicJob,
      hasEstimate: false,
      message: 'An estimate has not been issued for this repair job yet. Please check again later.',
      estimate: null
    };
  }

  const items = await customerEstimateRepository.listPublicItems(estimate._id);
  const isLatest = job.currentEstimate
    ? sameId(job.currentEstimate, estimate._id)
    : true;
  const hasDecision = Boolean(estimate.decision?.action);
  const canDecide = (
    isLatest &&
    !hasDecision &&
    estimate.status === 'Issued' &&
    job.status === 'Awaiting Approval'
  );
  const decisionState = getDecisionState({ estimate, isLatest, canDecide });

  let previousItems = [];
  if (estimate.versionNumber > 1 && estimate.basedOnEstimate) {
    previousItems = await customerEstimateRepository.listPublicItems(estimate.basedOnEstimate);
  }

  const previouslyApproved = await customerEstimateRepository.findPreviouslyApproved(
    job._id,
    estimate.versionNumber
  );

  const serializedItems = items.map((item) => {
    const publicItem = serializePublicItem(item);
    if (estimate.versionNumber > 1 && previousItems.length > 0) {
      const match = previousItems.find((prev) =>
        prev.type === item.type &&
        prev.description.trim().toLowerCase() === item.description.trim().toLowerCase()
      );
      if (!match) {
        publicItem.changeStatus = 'NEW';
      } else if (match.quantity !== item.quantity || match.unitPriceMinor !== item.unitPriceMinor) {
        publicItem.changeStatus = 'MODIFIED';
      } else {
        publicItem.changeStatus = 'UNCHANGED';
      }
    } else {
      publicItem.changeStatus = 'UNCHANGED';
    }
    return publicItem;
  });

  const previouslyApprovedEstimate = previouslyApproved ? {
    versionNumber: previouslyApproved.versionNumber,
    total: formatMinor(previouslyApproved.totalMinor),
    totalMinor: previouslyApproved.totalMinor,
    status: previouslyApproved.status,
    approvedAt: previouslyApproved.decision?.decidedAt || null
  } : null;

  return {
    job: publicJob,
    hasEstimate: true,
    message: null,
    estimate: {
      id: estimate._id,
      versionNumber: estimate.versionNumber,
      // Estimate revision: explain why a revised version needs authorisation.
      isRevision: estimate.versionNumber > 1,
      revisionReason: estimate.versionNumber > 1 ? estimate.changeReason || null : null,
      previousVersionNumber: estimate.versionNumber > 1 ? estimate.versionNumber - 1 : null,
      previouslyApprovedEstimate,
      currency: estimate.currency,
      totalMinor: estimate.totalMinor,
      total: formatMinor(estimate.totalMinor),
      issuedAt: estimate.issuedAt,
      status: estimate.status,
      decisionState,
      isLatest,
      isSuperseded: !isLatest,
      canDecide,
      decision: hasDecision ? {
        action: estimate.decision.action,
        decidedAt: estimate.decision.decidedAt
      } : null,
      proposedWork: items.map((item) => item.description),
      items: serializedItems
    }
  };
};

module.exports = {
  getCurrentEstimate
};
