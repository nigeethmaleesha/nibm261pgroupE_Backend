const mongoose = require('mongoose');
const repairJobRepository = require('../repositories/repairJobRepository');
const diagnosisRepository = require('../repositories/diagnosisRepository');
const estimateRepository = require('../repositories/estimateRepository');
const jobProgressLogRepository = require('../repositories/jobProgressLogRepository');
const repairProgressRepository = require('../repositories/repairProgressRepository');
const repairJobAssignmentAuditRepository = require('../repositories/repairJobAssignmentAuditRepository');

const createHttpError = (message, statusCode = 500, code = null) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

const serializeInternalUser = (user) => {
  if (!user) return null;
  return {
    id: user._id || user.id,
    fullName: user.fullName,
    email: user.email,
    contactNumber: user.contactNumber || null,
    role: user.role,
    isActive: user.isActive !== undefined ? user.isActive : true,
    isEmailVerified: user.isEmailVerified !== undefined ? user.isEmailVerified : true
  };
};

const normalizePagination = (limitVal, pageVal) => {
  const limit = Math.min(Math.max(Number.parseInt(limitVal, 10) || 50, 1), 100);
  const page = Math.max(Number.parseInt(pageVal, 10) || 1, 1);
  const skip = (page - 1) * limit;
  return { limit, page, skip };
};

/**
 * SCRUM-129 / SCRUM-127: Search and filter staff closed / archived repair records.
 * Allows filtering by text query, date range (when collected), and outcome (repaired vs unrepaired).
 */
const searchStaffArchivedJobs = async ({
  queryValue,
  startDate,
  endDate,
  outcome,
  limitValue,
  pageValue,
  actor
}) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can search archived repair records', 403, 'FORBIDDEN');
  }

  const query = String(queryValue || '').trim();
  if (query.length > 120) {
    throw createHttpError('Archive search query must not exceed 120 characters', 400, 'INVALID_QUERY');
  }

  let normalizedOutcome = null;
  if (outcome) {
    const lower = String(outcome).trim().toLowerCase();
    if (lower === 'repaired' || lower === 'unrepaired') {
      normalizedOutcome = lower;
    } else if (lower !== 'all') {
      throw createHttpError("Outcome filter must be 'repaired', 'unrepaired', or 'all'", 400, 'INVALID_OUTCOME');
    }
  }

  // Validate dates if supplied
  if (startDate) {
    const parsedStart = new Date(startDate);
    if (Number.isNaN(parsedStart.getTime())) {
      throw createHttpError('Invalid startDate format', 400, 'INVALID_DATE');
    }
  }
  if (endDate) {
    const parsedEnd = new Date(endDate);
    if (Number.isNaN(parsedEnd.getTime())) {
      throw createHttpError('Invalid endDate format', 400, 'INVALID_DATE');
    }
  }

  const { limit, page, skip } = normalizePagination(limitValue, pageValue);

  const [jobs, total] = await Promise.all([
    repairJobRepository.searchArchivedForStaff({
      queryValue: query,
      startDate,
      endDate,
      outcome: normalizedOutcome,
      limit,
      skip
    }),
    repairJobRepository.countArchivedForStaff({
      queryValue: query,
      startDate,
      endDate,
      outcome: normalizedOutcome
    })
  ]);

  const serializedJobs = jobs.map((job) => {
    const rawOutcome = job.collectionDetails?.outcome
      || (job.returnDetails?.returnedAt ? 'unrepaired' : 'repaired');
    const outcomeStr = String(rawOutcome).toLowerCase() === 'unrepaired' ? 'unrepaired' : 'repaired';
    const collectedAt = job.collectionDetails?.collectedAt || job.updatedAt;

    return {
      id: job._id,
      reference: job.reference,
      customer: {
        id: job.customer,
        fullName: job.customerSnapshot?.fullName || 'Unknown Customer',
        email: job.customerSnapshot?.email || '',
        contactNumber: job.customerSnapshot?.contactNumber || ''
      },
      device: {
        deviceType: job.deviceType,
        makeModel: job.makeModel,
        serialNumber: job.serialNumber || null,
        reportedFault: job.reportedFault
      },
      status: 'Collected',
      outcome: outcomeStr,
      outcomeDisplay: outcomeStr === 'repaired' ? 'Repaired' : 'Unrepaired Return',
      handover: {
        collectedAt,
        collectedBy: serializeInternalUser(job.collectionDetails?.collectedBy),
        customerIdentityConfirmed: Boolean(job.collectionDetails?.customerIdentityConfirmed),
        deviceHandedOver: Boolean(job.collectionDetails?.deviceHandedOver),
        notes: job.collectionDetails?.notes || null
      },
      assignedTechnician: serializeInternalUser(job.assignedTechnician),
      repairSummary: job.completionDetails?.customerSummary || null,
      returnReason: job.returnDetails?.reason || null,
      receivedAt: job.receivedAt,
      closedAt: collectedAt,
      updatedAt: job.updatedAt
    };
  });

  return {
    count: serializedJobs.length,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    jobs: serializedJobs
  };
};

/**
 * Builds the comprehensive Chronological Event Ledger for a closed job dossier.
 */
const buildStaffEventLedger = ({
  job,
  diagnosis,
  estimates = [],
  assignmentAudits = [],
  progressUpdates = [],
  jobProgressLogs = []
}) => {
  const events = [];

  // 1. Intake event
  events.push({
    id: `event-intake-${job._id}`,
    timestamp: job.receivedAt || job.createdAt,
    eventType: 'INTAKE',
    category: 'intake',
    title: 'Repair Intake Registered',
    description: `Device received from customer (${job.customerSnapshot?.fullName || 'Customer'}). Fault reported: "${job.reportedFault}".`,
    actor: job.createdBy ? serializeInternalUser(job.createdBy) : { fullName: 'Staff Member', role: 'owner_staff' },
    badge: { label: 'Intake', color: 'blue' }
  });

  // 2. Assignment event(s)
  if (assignmentAudits.length > 0) {
    assignmentAudits.forEach((audit, index) => {
      const isReassign = Boolean(audit.previousTechnician);
      events.push({
        id: `event-assign-${audit._id || index}`,
        timestamp: audit.assignedAt || audit.createdAt,
        eventType: isReassign ? 'REASSIGNMENT' : 'ASSIGNMENT',
        category: 'assignment',
        title: isReassign ? 'Technician Reassigned' : 'Technician Assigned',
        description: isReassign
          ? `Reassigned from ${audit.previousTechnician?.fullName || 'Previous Tech'} to ${audit.assignedTechnician?.fullName || 'Technician'}.`
          : `Assigned to technician ${audit.assignedTechnician?.fullName || 'Technician'}.`,
        actor: serializeInternalUser(audit.assignedBy),
        badge: { label: 'Assignment', color: 'indigo' }
      });
    });
  } else if (job.assignedTechnician && job.assignedAt) {
    events.push({
      id: `event-assign-initial-${job._id}`,
      timestamp: job.assignedAt,
      eventType: 'ASSIGNMENT',
      category: 'assignment',
      title: 'Technician Assigned',
      description: `Assigned to technician ${job.assignedTechnician?.fullName || 'Technician'}.`,
      actor: serializeInternalUser(job.assignedBy),
      badge: { label: 'Assignment', color: 'indigo' }
    });
  }

  // 3. Technical Diagnosis events
  if (diagnosis) {
    if (diagnosis.startedAt) {
      events.push({
        id: `event-diag-start-${job._id}`,
        timestamp: diagnosis.startedAt,
        eventType: 'DIAGNOSIS_STARTED',
        category: 'diagnosis',
        title: 'Diagnostic Inspection Started',
        description: 'Technician commenced physical inspection and diagnostic procedures.',
        actor: serializeInternalUser(diagnosis.startedBy || job.assignedTechnician),
        badge: { label: 'Diagnosis', color: 'cyan' }
      });
    }

    if (diagnosis.completedAt || job.diagnosisRecordedAt) {
      const diagTime = diagnosis.completedAt || job.diagnosisRecordedAt;
      const isUnrep = Boolean(diagnosis.isUnrepairable);
      let desc = isUnrep
        ? `Device diagnosed as unrepairable. Reason: ${diagnosis.unrepairableReason || diagnosis.findings || 'Not repairable'}.`
        : `Diagnostic findings recorded: "${diagnosis.findings || 'Diagnosis complete'}". Recommended work: "${diagnosis.recommendedWork || 'Standard repair'}".`;

      if (diagnosis.internalNotes) {
        desc += ` [Staff Note: ${diagnosis.internalNotes}]`;
      }

      events.push({
        id: `event-diag-record-${job._id}`,
        timestamp: diagTime,
        eventType: 'DIAGNOSIS_RECORDED',
        category: 'diagnosis',
        title: isUnrep ? 'Device Declared Unrepairable' : 'Technical Diagnosis Recorded',
        description: desc,
        actor: serializeInternalUser(diagnosis.completedBy || diagnosis.startedBy || job.assignedTechnician),
        badge: { label: isUnrep ? 'Unrepairable' : 'Diagnosis', color: isUnrep ? 'rose' : 'cyan' }
      });
    }
  }

  // 4. Estimates issued & decisions
  estimates.forEach((est) => {
    // Issued event
    const formattedAmount = (est.totalMinor / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: est.currency || 'LKR'
    });
    const revisionSuffix = est.reasonForRevision ? ` Reason: ${est.reasonForRevision}` : '';

    events.push({
      id: `event-est-issued-${est._id}`,
      timestamp: est.issuedAt || est.createdAt,
      eventType: 'ESTIMATE_ISSUED',
      category: 'estimate',
      title: `Estimate Version ${est.versionNumber} Issued (${formattedAmount})`,
      description: `Formal estimate v${est.versionNumber} prepared and sent to customer.${revisionSuffix}`,
      actor: est.issuedBy ? serializeInternalUser(est.issuedBy) : { fullName: 'Owner/Staff', role: 'owner_staff' },
      badge: { label: `Estimate v${est.versionNumber}`, color: 'amber' }
    });

    // Decision event
    if (est.decision && est.decision.action) {
      const isApproved = est.decision.action === 'APPROVED';
      const decTime = est.decision.decidedAt || est.updatedAt;
      const decNotes = est.decision.notes ? ` Notes: "${est.decision.notes}"` : '';

      events.push({
        id: `event-est-decided-${est._id}`,
        timestamp: decTime,
        eventType: isApproved ? 'ESTIMATE_APPROVED' : 'ESTIMATE_REJECTED',
        category: 'estimate',
        title: `Estimate v${est.versionNumber} ${isApproved ? 'Approved by Customer' : 'Declined by Customer'}`,
        description: `Customer ${isApproved ? 'accepted and authorised' : 'declined'} estimate v${est.versionNumber}.${decNotes}`,
        actor: {
          fullName: est.decision.decidedByCustomer ? (job.customerSnapshot?.fullName || 'Customer') : 'Customer (Staff recorded)',
          role: 'customer'
        },
        badge: { label: isApproved ? 'Authorised' : 'Declined', color: isApproved ? 'emerald' : 'rose' }
      });
    }
  });

  // 5. Parts hold events
  if (job.partsHold?.placedAt) {
    events.push({
      id: `event-parts-hold-${job._id}`,
      timestamp: job.partsHold.placedAt,
      eventType: 'PARTS_HOLD_PLACED',
      category: 'workshop',
      title: 'Parts Hold Placed',
      description: `Work paused awaiting component: "${job.partsHold.requiredPart || 'Required parts'}". Reason: ${job.partsHold.reason || 'Ordered'}.`,
      actor: serializeInternalUser(job.assignedTechnician),
      badge: { label: 'Parts Hold', color: 'orange' }
    });
  }

  if (job.partsHold?.releasedAt) {
    events.push({
      id: `event-parts-released-${job._id}`,
      timestamp: job.partsHold.releasedAt,
      eventType: 'PARTS_HOLD_RELEASED',
      category: 'workshop',
      title: 'Parts Hold Resolved',
      description: `Parts hold lifted. ${job.partsHold.resolutionNote ? `Resolution: ${job.partsHold.resolutionNote}` : 'Parts arrived and repair resumed.'}`,
      actor: serializeInternalUser(job.partsHold.releasedBy) || { fullName: 'Owner/Staff', role: 'owner_staff' },
      badge: { label: 'Hold Lifted', color: 'teal' }
    });
  }

  // 6. Workshop logs & progress updates
  jobProgressLogs.forEach((log) => {
    const isPublic = Boolean(log.is_public);
    events.push({
      id: `event-log-${log._id}`,
      timestamp: log.createdAt,
      eventType: isPublic ? 'PUBLIC_PROGRESS_UPDATE' : 'INTERNAL_WORK_NOTE',
      category: 'workshop',
      title: isPublic ? 'Technician Progress Update' : 'Internal Workshop Note',
      description: log.message,
      actor: log.recordedBy ? serializeInternalUser(log.recordedBy) : serializeInternalUser(job.assignedTechnician),
      badge: { label: isPublic ? 'Update' : 'Internal', color: isPublic ? 'sky' : 'slate' },
      isInternalOnly: !isPublic
    });
  });

  // 7. QC Completion OR Ready for Return
  if (job.completionDetails?.completedAt) {
    const qc = job.completionDetails;
    events.push({
      id: `event-qc-complete-${job._id}`,
      timestamp: qc.completedAt,
      eventType: 'QC_COMPLETED',
      category: 'qc',
      title: 'Repair Completed & Quality Checks Passed',
      description: `Quality control passed. Fault resolved: ${qc.faultResolved ? 'Yes' : 'No'}; Functional tests passed: ${qc.functionalTestPassed ? 'Yes' : 'No'}.${qc.customerSummary ? ` Customer summary: "${qc.customerSummary}".` : ''}${qc.internalNotes ? ` [Internal QC Note: ${qc.internalNotes}]` : ''}`,
      actor: serializeInternalUser(qc.completedBy) || serializeInternalUser(job.assignedTechnician),
      badge: { label: 'QC Passed', color: 'emerald' }
    });
  }

  if (job.returnDetails?.returnedAt) {
    const rd = job.returnDetails;
    events.push({
      id: `event-ready-return-${job._id}`,
      timestamp: rd.returnedAt,
      eventType: 'READY_FOR_RETURN',
      category: 'qc',
      title: 'Prepared for Unrepaired Return',
      description: `Device packaged for return without repair. Reason: ${rd.reason || 'Unrepaired return'}.${rd.notes ? ` Staff notes: "${rd.notes}".` : ''}`,
      actor: serializeInternalUser(rd.returnedBy) || { fullName: 'Staff Member', role: 'owner_staff' },
      badge: { label: 'Return Prepared', color: 'amber' }
    });
  }

  // 8. Handover / Collected signoff
  if (job.collectionDetails?.collectedAt || job.status === 'Collected') {
    const cd = job.collectionDetails || {};
    const collectedTime = cd.collectedAt || job.updatedAt;
    const isRepaired = String(cd.outcome || '').toLowerCase() !== 'unrepaired' && !job.returnDetails?.returnedAt;

    events.push({
      id: `event-collected-${job._id}`,
      timestamp: collectedTime,
      eventType: 'JOB_COLLECTED',
      category: 'handover',
      title: isRepaired ? 'Customer Handover Completed (Repaired)' : 'Customer Handover Completed (Unrepaired)',
      description: `Device released to customer. Customer identity verified: ${cd.customerIdentityConfirmed ? 'Confirmed' : 'Yes'}; Device handed over: ${cd.deviceHandedOver ? 'Confirmed' : 'Yes'}.${cd.notes ? ` Handover notes: "${cd.notes}".` : ''}`,
      actor: serializeInternalUser(cd.collectedBy) || { fullName: 'Shop Staff', role: 'owner_staff' },
      badge: { label: isRepaired ? 'Handover (Repaired)' : 'Handover (Unrepaired)', color: isRepaired ? 'emerald' : 'amber' }
    });
  }

  // Sort chronological (earliest first)
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return events;
};

/**
 * SCRUM-129 / SCRUM-128: Complete Read-Only Job Dossier for Owner/Staff.
 * Returns 100% of audit data, technical diagnosis with internal notes, full estimate history,
 * assignment audit ledger, workshop logs, and the chronological event ledger.
 */
const getStaffArchivedJobDetail = async ({ jobIdentifier, actor }) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can access archived job audit dossiers', 403, 'FORBIDDEN');
  }

  const job = await repairJobRepository.findArchivedDetailForStaff(jobIdentifier);
  if (!job) {
    // Check if the job exists but has not been collected yet
    const existing = await repairJobRepository.findByIdOrReference(jobIdentifier);
    if (existing) {
      if (existing.status !== 'Collected') {
        throw createHttpError(
          `Repair job is currently in '${existing.status}' status and has not been archived/collected`,
          409,
          'JOB_NOT_COLLECTED'
        );
      }
    }
    throw createHttpError('Repair job not found', 404, 'NOT_FOUND');
  }

  // Re-verify status
  if (job.status !== 'Collected') {
    throw createHttpError(
      `Repair job is currently in '${job.status}' status and has not been archived/collected`,
      409,
      'JOB_NOT_COLLECTED'
    );
  }

  // Fetch all associated audit datasets in parallel
  const [
    diagnosis,
    allEstimates,
    assignmentAudits,
    jobProgressLogs,
    progressUpdates
  ] = await Promise.all([
    diagnosisRepository.findByJob(job._id),
    estimateRepository.listByJob(job._id),
    repairJobAssignmentAuditRepository.listByJob(job._id, 100),
    jobProgressLogRepository.listByJob(job._id),
    repairProgressRepository.listByJob(job._id)
  ]);

  // Fetch line items for each estimate version
  const serializedEstimates = await Promise.all(
    allEstimates.map(async (est) => {
      const items = await estimateRepository.listItems(est._id);
      return {
        id: est._id,
        versionNumber: est.versionNumber,
        status: est.status,
        currency: est.currency || 'LKR',
        subtotalMinor: est.subtotalMinor,
        taxMinor: est.taxMinor,
        totalMinor: est.totalMinor,
        reasonForRevision: est.reasonForRevision || null,
        issuedAt: est.issuedAt || est.createdAt,
        issuedBy: serializeInternalUser(est.issuedBy),
        decision: est.decision?.action
          ? {
              action: est.decision.action,
              decidedAt: est.decision.decidedAt || null,
              decidedByCustomer: Boolean(est.decision.decidedByCustomer),
              notes: est.decision.notes || null,
              rejectionReason: est.decision.rejectionReason || null
            }
          : null,
        items: items.map((item) => ({
          id: item._id,
          lineNumber: item.lineNumber,
          itemType: item.itemType,
          partDescription: item.partDescription || item.description || '',
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          totalMinor: item.totalMinor
        }))
      };
    })
  );

  // Construct Chronological Event Ledger
  const eventLedger = buildStaffEventLedger({
    job,
    diagnosis,
    estimates: allEstimates,
    assignmentAudits,
    progressUpdates,
    jobProgressLogs
  });

  // Determine outcome
  const rawOutcome = job.collectionDetails?.outcome
    || (job.returnDetails?.returnedAt ? 'unrepaired' : 'repaired');
  const outcome = String(rawOutcome).toLowerCase() === 'unrepaired' ? 'unrepaired' : 'repaired';
  const collectedAt = job.collectionDetails?.collectedAt || job.updatedAt;

  // Turnaround duration in days
  const intakeDate = new Date(job.receivedAt || job.createdAt).getTime();
  const closeDate = new Date(collectedAt).getTime();
  const durationDays = Math.max(0, Math.round((closeDate - intakeDate) / (1000 * 60 * 60 * 24)));

  return {
    isReadOnly: true,
    outcome,
    outcomeDisplay: outcome === 'repaired' ? 'Repaired & Collected' : 'Unrepaired Return',
    summary: {
      totalEstimates: serializedEstimates.length,
      totalWorkshopNotes: jobProgressLogs.length,
      totalAuditEvents: eventLedger.length,
      durationDays,
      isRepaired: outcome === 'repaired'
    },
    job: {
      id: job._id,
      reference: job.reference,
      status: 'Collected',
      deviceType: job.deviceType,
      makeModel: job.makeModel,
      serialNumber: job.serialNumber || null,
      reportedFault: job.reportedFault,
      physicalCondition: job.physicalCondition || null,
      accessories: job.accessories || [],
      receivedAt: job.receivedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      revision: job.revision || 0,
      customerSnapshot: {
        fullName: job.customerSnapshot?.fullName || '',
        email: job.customerSnapshot?.email || '',
        contactNumber: job.customerSnapshot?.contactNumber || '',
        alternateContactNumber: job.customerSnapshot?.alternateContactNumber || null,
        address: job.customerSnapshot?.address || null
      },
      customer: job.customer,
      createdBy: serializeInternalUser(job.createdBy)
    },
    handover: {
      collectedAt,
      collectedBy: serializeInternalUser(job.collectionDetails?.collectedBy),
      customerIdentityConfirmed: Boolean(job.collectionDetails?.customerIdentityConfirmed),
      deviceHandedOver: Boolean(job.collectionDetails?.deviceHandedOver),
      outcome,
      notes: job.collectionDetails?.notes || null
    },
    assignment: {
      currentTechnician: serializeInternalUser(job.assignedTechnician),
      assignedBy: serializeInternalUser(job.assignedBy),
      assignedAt: job.assignedAt || null,
      auditHistory: assignmentAudits.map((a) => ({
        id: a._id,
        previousTechnician: serializeInternalUser(a.previousTechnician),
        assignedTechnician: serializeInternalUser(a.assignedTechnician),
        assignedBy: serializeInternalUser(a.assignedBy),
        assignedAt: a.assignedAt || a.createdAt
      }))
    },
    diagnosis: diagnosis ? {
      isRecorded: Boolean(diagnosis.completedAt || job.diagnosisRecordedAt),
      startedAt: diagnosis.startedAt || null,
      startedBy: serializeInternalUser(diagnosis.startedBy),
      completedAt: diagnosis.completedAt || job.diagnosisRecordedAt || null,
      completedBy: serializeInternalUser(diagnosis.completedBy),
      findings: diagnosis.findings || null,
      recommendedWork: diagnosis.recommendedWork || null,
      publicSummary: diagnosis.publicSummary || null,
      internalNotes: diagnosis.internalNotes || null, // Full staff audit access!
      isUnrepairable: Boolean(diagnosis.isUnrepairable),
      unrepairableReason: diagnosis.unrepairableReason || null
    } : null,
    estimates: serializedEstimates,
    qcCompletion: job.completionDetails?.completedAt ? {
      completedAt: job.completionDetails.completedAt,
      completedBy: serializeInternalUser(job.completionDetails.completedBy),
      faultResolved: Boolean(job.completionDetails.faultResolved),
      functionalTestPassed: Boolean(job.completionDetails.functionalTestPassed),
      functionalTestNotes: job.completionDetails.functionalTestNotes || null,
      customerSummary: job.completionDetails.customerSummary || null,
      internalNotes: job.completionDetails.internalNotes || null
    } : null,
    returnDetails: job.returnDetails?.returnedAt ? {
      returnedAt: job.returnDetails.returnedAt,
      returnedBy: serializeInternalUser(job.returnDetails.returnedBy),
      reason: job.returnDetails.reason || null,
      notes: job.returnDetails.notes || null
    } : null,
    partsHold: job.partsHold ? {
      active: Boolean(job.partsHold.active),
      requiredPart: job.partsHold.requiredPart || null,
      reason: job.partsHold.reason || null,
      internalNote: job.partsHold.internalNote || null,
      placedAt: job.partsHold.placedAt || null,
      releasedAt: job.partsHold.releasedAt || null,
      resolutionNote: job.partsHold.resolutionNote || null
    } : null,
    workshopLogs: jobProgressLogs.map((log) => ({
      id: log._id,
      entryId: log.entryId,
      message: log.message,
      isPublic: Boolean(log.is_public),
      recordedBy: serializeInternalUser(log.recordedBy),
      createdAt: log.createdAt
    })),
    eventLedger
  };
};

module.exports = {
  searchStaffArchivedJobs,
  getStaffArchivedJobDetail
};
