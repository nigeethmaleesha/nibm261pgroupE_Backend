const repairJobRepository = require('../repositories/repairJobRepository');
const estimateRepository = require('../repositories/estimateRepository');
const { REVISION_BLOCKED_STATUSES } = require('../models/RepairJob');

/*
 * Estimate revision workflow rules shared by the staff estimate APIs and any
 * later repair-progress/completion story. Repair work is authorised if any issued
 * estimate version has been approved by the customer. If a revision is rejected,
 * repair work proceeds under the previously approved estimate version scope.
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

const getWorkAuthorisation = async (job, currentEstimate) => {
  const repairReasons = [];

  const approvedEstimate = (currentEstimate?.status === 'Approved' || currentEstimate?.decision?.action === 'APPROVED')
    ? currentEstimate
    : await estimateRepository.findLatestApprovedByJob(job._id);

  if (!currentEstimate && !approvedEstimate) {
    repairReasons.push('No estimate has been issued for this repair job');
  } else if (!approvedEstimate) {
    repairReasons.push(
      `Estimate version ${currentEstimate.versionNumber} must be approved by the customer before repair work can continue (current: ${currentEstimate.status})`
    );
  }
  if (REVISION_BLOCKED_STATUSES.includes(job.status)) {
    repairReasons.push(`Repair work is closed for this job (current: ${job.status})`);
  }

  const partsHoldActive = Boolean(job.partsHold?.active);
  const completionReasons = [...repairReasons];
  if (partsHoldActive) {
    completionReasons.push('An unresolved parts hold must be released before the repair can be completed');
  }

  return {
    latestVersionNumber: currentEstimate ? currentEstimate.versionNumber : null,
    approvedVersionNumber: approvedEstimate ? approvedEstimate.versionNumber : null,
    partsHoldActive,
    canContinueRepair: repairReasons.length === 0,
    canComplete: completionReasons.length === 0,
    repairBlockedReasons: repairReasons,
    completionBlockedReasons: completionReasons
  };
};

// Throws 409 REPAIR_NOT_AUTHORISED unless the requested action is allowed.
// action: 'REPAIR' (start/continue repair work) or 'COMPLETE' (finish repair).
const assertRepairWorkAllowed = async (job, action = 'REPAIR') => {
  const currentEstimate = await estimateRepository.findCurrentByJob(job);
  const authorisation = await getWorkAuthorisation(job, currentEstimate);
  const reasons = action === 'COMPLETE'
    ? authorisation.completionBlockedReasons
    : authorisation.repairBlockedReasons;

  if (reasons.length > 0) {
    throw createHttpError(reasons[0], 409, 'REPAIR_NOT_AUTHORISED', reasons);
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
