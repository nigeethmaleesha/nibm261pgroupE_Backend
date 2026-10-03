const repairJobRepository = require('../repositories/repairJobRepository');
const repairProgressRepository = require('../repositories/repairProgressRepository');
const jobProgressLogRepository = require('../repositories/jobProgressLogRepository');
const estimateRepository = require('../repositories/estimateRepository');
const diagnosisRepository = require('../repositories/diagnosisRepository');
const { formatMinor } = require('../utils/money');

const createHttpError = (message, statusCode, code = null, details = null) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.codeName = code;
  if (details) error.details = details;
  return error;
};

const sameId = (left, right) => (
  Boolean(left) && Boolean(right) && String(left._id || left) === String(right._id || right)
);

const getHandoverInstruction = (job) => {
  if (job.status === 'Ready for Collection') {
    return `Your device repair has been completed and quality tested. It is ready for collection at our service centre. Please bring your repair reference (${job.reference}) and a valid photo ID to collect your device. Any balance due can be settled upon collection.`;
  }
  if (job.status === 'Ready for Return') {
    const reasonText = job.returnDetails?.reason ? ` (Reason: ${job.returnDetails.reason})` : '';
    return `Your device is ready for return unrepaired${reasonText}. Please visit our service centre with your repair reference (${job.reference}) and a valid photo ID to collect your device.`;
  }
  return null;
};

const resolveCollectionDetails = (job, collectedUpdate, currentEstimate, diagnosis) => {
  if (job.status !== 'Collected') {
    return {
      collection: null,
      collectedAt: null,
      collectionTime: null,
      collectionOutcome: null
    };
  }

  const recordedTime = job.collectionDetails?.collectedAt
    || (collectedUpdate ? collectedUpdate.createdAt : null)
    || job.updatedAt;

  let outcome = job.collectionDetails?.outcome || null;
  if (!outcome) {
    if (collectedUpdate?.fromStatus === 'Ready for Collection') {
      outcome = 'repaired';
    } else if (collectedUpdate?.fromStatus === 'Ready for Return') {
      outcome = 'unrepaired';
    } else if (job.repairWork?.approvedEstimate || currentEstimate?.status === 'Approved') {
      outcome = 'repaired';
    } else if (diagnosis?.isUnrepairable || currentEstimate?.status === 'Rejected') {
      outcome = 'unrepaired';
    } else {
      outcome = 'repaired';
    }
  }

  const outcomeDescription = outcome === 'repaired'
    ? 'Device was successfully repaired and collected by customer.'
    : 'Device was collected unrepaired by customer.';

  const collection = {
    collectedAt: recordedTime,
    collectionTime: recordedTime,
    outcome,
    outcomeDescription
  };

  return {
    collection,
    collectedAt: recordedTime,
    collectionTime: recordedTime,
    collectionOutcome: outcome
  };
};

const buildPublicEvents = ({
  job,
  progressUpdates = [],
  publicLogs = [],
  estimates = [],
  diagnosis = null
}) => {
  const events = [];

  // 1. Intake Event
  events.push({
    id: `intake-${job._id}`,
    eventType: 'INTAKE',
    status: 'Received',
    title: 'Repair Intake Registered',
    description: `Device received and logged for inspection (${job.makeModel}).`,
    timestamp: job.receivedAt || job.createdAt,
    date: (job.receivedAt || job.createdAt).toISOString()
  });

  // 2. Diagnosis Event (customer-safe publicSummary only)
  if (diagnosis && (diagnosis.completedAt || job.diagnosisRecordedAt)) {
    const diagTimestamp = diagnosis.completedAt || job.diagnosisRecordedAt;
    events.push({
      id: `diagnosis-${diagnosis._id || job._id}`,
      eventType: 'DIAGNOSIS',
      status: 'Diagnosis Recorded',
      title: 'Diagnosis Completed',
      description: diagnosis.publicSummary || (
        diagnosis.isUnrepairable
          ? 'Technical diagnosis completed. Device was deemed unrepairable.'
          : 'Technical diagnosis completed and documented.'
      ),
      timestamp: diagTimestamp,
      date: new Date(diagTimestamp).toISOString()
    });
  }

  // 3. Estimate Events (issued & customer decisions)
  for (const est of estimates) {
    events.push({
      id: `estimate-issued-${est._id}`,
      eventType: 'ESTIMATE_ISSUED',
      status: 'Awaiting Approval',
      title: `Repair Estimate Issued (v${est.versionNumber})`,
      description: `Repair estimate of LKR ${formatMinor(est.totalMinor)} issued for customer review.`,
      timestamp: est.createdAt,
      date: new Date(est.createdAt).toISOString()
    });

    if (est.decision?.decidedAt) {
      const isApproved = est.decision.action === 'APPROVED' || est.status === 'Approved';
      events.push({
        id: `estimate-decision-${est._id}`,
        eventType: isApproved ? 'ESTIMATE_APPROVED' : 'ESTIMATE_REJECTED',
        status: isApproved ? 'Approved' : 'Estimate Rejected',
        title: isApproved ? `Estimate Approved (v${est.versionNumber})` : `Estimate Rejected (v${est.versionNumber})`,
        description: isApproved
          ? `Customer approved estimate version ${est.versionNumber}.`
          : `Customer rejected estimate version ${est.versionNumber}.`,
        timestamp: est.decision.decidedAt,
        date: new Date(est.decision.decidedAt).toISOString()
      });
    }
  }

  // 4. Status Transition Events from repair_progress_updates
  // Exclude internal notes and technician IDs entirely.
  for (const update of progressUpdates) {
    if (update.fromStatus === update.toStatus) {
      continue; // Note-only updates are internal; work notes come from publicLogs
    }

    let title;
    let description;

    switch (update.toStatus) {
      case 'Diagnosing':
        title = 'Diagnosis Started';
        description = 'Device inspection and diagnostic testing initiated.';
        break;
      case 'In Repair':
        title = update.fromStatus === 'Waiting for Parts' ? 'Repair Resumed' : 'Repair Started';
        description = update.fromStatus === 'Waiting for Parts'
          ? 'Required parts received; repair work resumed.'
          : 'Technician commenced repair work under approved estimate.';
        break;
      case 'Waiting for Parts':
        title = 'Waiting for Parts';
        description = job.partsHold?.reason || 'Repair temporarily paused awaiting required replacement parts.';
        break;
      case 'Ready for Collection':
        title = 'Ready for Collection';
        description = job.completionDetails?.customerSummary
          || 'Repair completed and quality tested. Device is ready for customer collection.';
        break;
      case 'Ready for Return':
        title = 'Ready for Return';
        description = job.returnDetails?.reason
          ? `Device is prepared and ready for customer return unrepaired (${job.returnDetails.reason}).`
          : 'Device is prepared and ready for customer return unrepaired.';
        break;
      case 'Collected':
        title = 'Device Collected';
        description = 'Device handed over to customer.';
        break;
      default:
        title = `Status: ${update.toStatus}`;
        description = `Repair workflow updated to ${update.toStatus}.`;
    }

    events.push({
      id: `status-${update._id}`,
      eventType: 'STATUS_CHANGE',
      status: update.toStatus,
      title,
      description,
      timestamp: update.createdAt,
      date: new Date(update.createdAt).toISOString()
    });
  }

  // 5. Customer-safe progress updates from job_progress_logs (is_public: true)
  const corrected = new Set(
    publicLogs.filter((log) => log.correctionOf).map((log) => String(log.correctionOf))
  );

  for (const log of publicLogs) {
    if (corrected.has(String(log.entryId))) {
      continue; // Skip entries superseded by a correction
    }

    events.push({
      id: `progress-${log.entryId}`,
      eventType: 'PROGRESS_UPDATE',
      status: log.jobStatus || 'In Repair',
      title: log.correctionOf ? 'Progress Update (Corrected)' : 'Work Progress Update',
      description: log.text,
      timestamp: log.createdAt,
      date: new Date(log.createdAt).toISOString()
    });
  }

  // Deduplicate events that might share the exact same id or type+timestamp
  const seen = new Set();
  const deduped = [];
  for (const ev of events) {
    if (!seen.has(ev.id)) {
      seen.add(ev.id);
      deduped.push(ev);
    }
  }

  // Sort strictly in chronological order (oldest to newest)
  deduped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return deduped;
};

// SCRUM-109: Customer public tracking view.
// Sanitized of internal notes and technician IDs.
// Enforces strict customer ownership check so cross-customer access yields 404 NOT_FOUND.
const getJobTracking = async ({ jobIdentifier, actor }) => {
  if (!actor || !['customer', 'owner_staff'].includes(actor.role)) {
    throw createHttpError('Only customers can track their repair job', 403, 'FORBIDDEN');
  }

  const job = await repairJobRepository.findByIdOrReference(jobIdentifier);

  // Return the same 404 response for non-existent jobs and cross-customer requests.
  // This structurally prevents IDOR or leaking another customer's repair records.
  if (!job || (actor.role === 'customer' && !sameId(job.customer, actor._id))) {
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  const [progressUpdates, publicLogs, currentEstimate, allEstimates, diagnosis] = await Promise.all([
    repairProgressRepository.listByJob(job._id),
    jobProgressLogRepository.listPublicByJob(job._id),
    estimateRepository.findCurrentByJob(job),
    estimateRepository.listByJob(job._id),
    diagnosisRepository.findByJob(job._id)
  ]);

  const collectedUpdate = progressUpdates.find((u) => u.toStatus === 'Collected') || null;

  // 1. Handover instruction
  const handoverInstruction = getHandoverInstruction(job);

  // 2. Parts hold public reason (never leaks internal notes or actor IDs)
  const isPartsHoldActive = Boolean(job.partsHold?.active) || job.status === 'Waiting for Parts';
  const publicDelayReason = isPartsHoldActive
    ? (job.partsHold?.reason || 'Repair temporarily paused awaiting required replacement parts.')
    : null;

  const partsDelay = isPartsHoldActive
    ? {
      requiredPart: job.partsHold?.requiredPart || null,
      reason: publicDelayReason,
      publicDelayReason,
      placedAt: job.partsHold?.placedAt || null
    }
    : null;

  // 3. Awaiting Approval estimate decision links
  const isAwaitingApproval = job.status === 'Awaiting Approval';
  const estimateDecision = (isAwaitingApproval && currentEstimate)
    ? {
      estimateId: currentEstimate._id,
      versionNumber: currentEstimate.versionNumber,
      total: formatMinor(currentEstimate.totalMinor),
      totalMinor: currentEstimate.totalMinor,
      status: currentEstimate.status,
      canDecide: true,
      decisionUrl: `/api/jobs/${job.reference}/estimate-decision`,
      viewEstimateUrl: `/api/customer/jobs/${job.reference}/current-estimate`
    }
    : null;

  // 4. Collection details
  const {
    collection,
    collectedAt,
    collectionTime,
    collectionOutcome
  } = resolveCollectionDetails(job, collectedUpdate, currentEstimate, diagnosis);

  // 5. Dated public events in chronological order
  const publicEvents = buildPublicEvents({
    job,
    progressUpdates,
    publicLogs,
    estimates: allEstimates,
    diagnosis
  });

  return {
    job: {
      id: job._id,
      reference: job.reference,
      status: job.status,
      deviceType: job.deviceType,
      makeModel: job.makeModel,
      serialNumber: job.serialNumber || null,
      reportedFault: job.reportedFault,
      receivedAt: job.receivedAt,
      updatedAt: job.updatedAt
    },
    currentStatus: job.status,
    status: job.status,
    actionRequired: isAwaitingApproval,
    actionType: isAwaitingApproval ? 'ESTIMATE_DECISION' : null,
    actionMessage: isAwaitingApproval
      ? 'Your approval is required for the repair estimate before work can proceed.'
      : null,
    estimateDecision,
    estimateDecisionLink: isAwaitingApproval ? `/api/jobs/${job.reference}/estimate-decision` : null,
    currentEstimateLink: currentEstimate ? `/api/customer/jobs/${job.reference}/current-estimate` : null,
    publicDelayReason,
    partsDelay,
    handoverInstruction,
    returnDetails: {
      returnedAt: job.returnDetails?.returnedAt || null,
      reason: job.returnDetails?.reason || null,
      notes: job.returnDetails?.notes || null
    },
    collection,
    collectedAt,
    collectionTime,
    collectionOutcome,
    publicEvents,
    timelineCount: publicEvents.length
  };
};

module.exports = {
  getJobTracking
};
