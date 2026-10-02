const repairJobRepository = require('../repositories/repairJobRepository');
const estimateRepository = require('../repositories/estimateRepository');
const { REVISION_BLOCKED_STATUSES } = require('../models/RepairJob');
/*
 * Repair authorisation rules shared by the estimate, progress and start/resume
 * repair APIs. Repair work is authorised only by the LATEST issued estimate
 * version, and only once the customer has approved it:
 *
 * - Missing estimate, pending (Issued), Rejected or Superseded latest version:
 *   repair work and completion are blocked with a clear reason.
 * - Starting or resuming repair (START) additionally requires that no parts
 *   hold is active; completing (COMPLETE) requires the same.
 */

const createHttpError = (message, statusCode, code, details) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.codeName = code;
  if (details) error.details = details;
  return error;
};

const revisionEligibilityFor = (job, currentEstimate) => {
  const reasons = [];

  if (!currentEstimate) {
    reasons.push('An issued estimate is required before a revised estimate can be issued');
  }
  if (REVISION_BLOCKED_STATUSES.includes(job.status)) {
    reasons.push(`A revised estimate cannot be issued once the job is ${job.status}`);
  }

  return {
    eligible: reasons.length === 0,
    reasons
  };
};

const isApproved = (estimate) => (
  estimate?.status === 'Approved' || estimate?.decision?.action === 'APPROVED'
);

const isRejected = (estimate) => (
  estimate?.status === 'Rejected' || estimate?.decision?.action === 'REJECTED'
);

const approvalBlockReason = (currentEstimate) => {
  if (!currentEstimate) {
    return 'No estimate has been issued for this repair job';
  }
  const version = currentEstimate.versionNumber;
  if (isApproved(currentEstimate)) return null;
  if (isRejected(currentEstimate)) {
    return `Estimate version ${version} was rejected by the customer. Issue a new revision or return the device.`;
  }
  if (currentEstimate.status === 'Superseded' || currentEstimate.supersededBy) {
    return `Estimate version ${version} has been superseded by a newer version that is not yet approved`;
  }
  return `Estimate version ${version} is awaiting customer approval`;
};

// Kept async so callers do not change if a lookup is needed again later.
const getWorkAuthorisation = async (job, currentEstimate) => {
  const repairReasons = [];

  const approvalReason = approvalBlockReason(currentEstimate);
  if (approvalReason) repairReasons.push(approvalReason);
  if (REVISION_BLOCKED_STATUSES.includes(job.status)) {
    repairReasons.push(`Repair work is closed for this job (current: ${job.status})`);
  }

  const partsHoldActive = Boolean(job.partsHold?.active);
  const holdReasons = partsHoldActive
    ? ['An unresolved parts hold is active. Resolve the parts hold before starting or completing repair.']
    : [];
  const startReasons = [...repairReasons, ...holdReasons];
  const completionReasons = [...repairReasons, ...holdReasons];

  return {
    latestVersionNumber: currentEstimate ? currentEstimate.versionNumber : null,
    approvedVersionNumber: approvalReason ? null : currentEstimate.versionNumber,
    approvedEstimateId: approvalReason ? null : currentEstimate._id,
    partsHoldActive,
    canContinueRepair: repairReasons.length === 0,
    canStartRepair: startReasons.length === 0,
    canComplete: completionReasons.length === 0,
    repairBlockedReasons: repairReasons,
    startBlockedReasons: startReasons,
    completionBlockedReasons: completionReasons
  };
};

// Throws 409 REPAIR_NOT_AUTHORISED unless the requested action is allowed.
// action: 'REPAIR' (continue repair work), 'START' (start/resume repair: also
// needs no active parts hold) or 'COMPLETE' (finish repair).
const assertRepairWorkAllowed = async (job, action = 'REPAIR') => {
  const currentEstimate = await estimateRepository.findCurrentByJob(job);
  const authorisation = await getWorkAuthorisation(job, currentEstimate);
  const reasonsByAction = {
    START: authorisation.startBlockedReasons,
    COMPLETE: authorisation.completionBlockedReasons,
    REPAIR: authorisation.repairBlockedReasons
  };
  const reasons = reasonsByAction[action] || authorisation.repairBlockedReasons;

  if (reasons.length > 0) {
    // Only the parts hold is in the way: give it its own code.
    const code = authorisation.repairBlockedReasons.length === 0 && authorisation.partsHoldActive
      ? 'PARTS_HOLD_ACTIVE'
      : 'REPAIR_NOT_AUTHORISED';
    throw createHttpError(reasons[0], 409, code, reasons);
  }

  return authorisation;
};

// Convenience loader for routes that address a job by :jobIdentifier.
const assertRepairWorkAllowedForJob = async (jobIdentifier, action = 'REPAIR') => {
  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);
  if (!job) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  await assertRepairWorkAllowed(job, action);
  return job;
};

module.exports = {
  revisionEligibilityFor,
  getWorkAuthorisation,
  assertRepairWorkAllowed,
  assertRepairWorkAllowedForJob
};
