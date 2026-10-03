const mongoose = require('mongoose');
const RepairJob = require('../models/RepairJob');

const create = (data) => RepairJob.create(data);

const findByIdempotency = (createdBy, idempotencyKey) => RepairJob.findOne({
  createdBy,
  idempotencyKey
}).select('+idempotencyKey +requestHash');


const findByIdOrReference = (identifier, { session = null } = {}) => {
  const value = String(identifier || '').trim();
  const filter = mongoose.isValidObjectId(value)
    ? { _id: value }
    : { reference: value.toUpperCase() };

  let query = RepairJob.findOne(filter);
  if (session) query = query.session(session);
  return query;
};


const identifierFilter = (identifier) => {
  const value = String(identifier || '').trim();
  return mongoose.isValidObjectId(value)
    ? { _id: value }
    : { reference: value.toUpperCase() };
};

const findByIdForEstimate = (jobId, { session = null } = {}) => {
  let query = RepairJob.findById(jobId);
  if (session) query = query.session(session);
  return query;
};

const attachInitialEstimate = (
  jobId,
  estimateId,
  expectedRevision,
  session
) => RepairJob.findOneAndUpdate(
  {
    _id: jobId,
    status: 'Diagnosing',
    currentEstimate: null,
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision })
  },
  {
    $set: {
      currentEstimate: estimateId,
      status: 'Awaiting Approval'
    },
    $inc: { revision: 1 }
  },
  { new: true, session }
);


const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// SCRUM-10: Owner/Staff shop-wide repair-job search. The requested query is
// safely escaped before being used in MongoDB regex conditions.
const searchForStaff = (queryValue = '', limit = 50) => {
  const query = String(queryValue || '').trim();
  const filter = {};

  if (query) {
    const safeQuery = escapeRegExp(query);
    const matcher = { $regex: safeQuery, $options: 'i' };
    filter.$or = [
      { reference: matcher },
      { 'customerSnapshot.fullName': matcher },
      { 'customerSnapshot.contactNumber': matcher }
    ];
  }

  return RepairJob.find(filter)
    .select(
      'reference customer customerSnapshot deviceType makeModel serialNumber reportedFault receivedAt status assignedTechnician assignedBy assignedAt currentEstimate revision createdAt updatedAt'
    )
    .populate(
      'assignedTechnician',
      'fullName email contactNumber role isActive isEmailVerified'
    )
    .sort({ receivedAt: -1, _id: -1 })
    .limit(limit);
};

// SCRUM-10: detailed Owner/Staff view for a selected result.
const findForStaffDetail = (identifier, { session = null } = {}) => {
  let query = RepairJob.findOne(identifierFilter(identifier))
    .populate(
      'assignedTechnician',
      'fullName email contactNumber role isActive isEmailVerified'
    )
    .populate('assignedBy', 'fullName email role')
    .populate(
      'currentEstimate',
      'versionNumber currency totalMinor status issuedAt decision'
    );

  if (session) query = query.session(session);
  return query;
};

// SCRUM-11: assignment update is guarded by both workflow state and optimistic
// revision so a Collected/concurrently changed job is never silently overwritten.
const assignTechnician = (
  jobId,
  technicianId,
  assignedBy,
  assignedAt,
  expectedRevision,
  session
) => {
  const revisionFilter = expectedRevision === 0
    ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
    : { revision: expectedRevision };

  return RepairJob.findOneAndUpdate(
    {
      _id: jobId,
      status: { $ne: 'Collected' },
      ...revisionFilter
    },
    {
      $set: {
        assignedTechnician: technicianId,
        assignedBy,
        assignedAt
      },
      $inc: { revision: 1 }
    },
    { new: true, session }
  );
};

// Estimate revision: move currentEstimate to the new version and send the job
// back to Awaiting Approval. The filter pins the job to the state the service
// validated (status, previous estimate and revision) so a concurrent decision or
// revision makes this update miss instead of overwriting it. `partsHold` is not
// touched here: an active hold stays active and a resolved hold stays resolved.
const attachRevisedEstimate = (
  jobId,
  { previousEstimateId, estimateId, expectedStatus, expectedRevision },
  session
) =>
  RepairJob.findOneAndUpdate(
    {
      _id: jobId,
      status: expectedStatus,
      currentEstimate: previousEstimateId,
      ...(expectedRevision === 0
        ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
        : { revision: expectedRevision })
    },
    {
      $set: {
        currentEstimate: estimateId,
        status: 'Awaiting Approval'
      },
      $inc: { revision: 1 }
    },
    { returnDocument: 'after', session }
  );

// Repair progress lock: the update only applies when the job is still in the
// status, revision and current estimate the service validated. Issuing a
// revised estimate changes all three (status -> Awaiting Approval), so a
// progress update that races a revision misses instead of slipping through.
// `extraFilter` adds save-time rechecks, e.g. start/resume repair requires no
// active parts hold and that the job is still assigned to the technician.
const applyProgressUpdate = (
  jobId,
  { expectedStatus, expectedRevision, expectedEstimateId, set, extraFilter = {} }
) => RepairJob.findOneAndUpdate(
  {
    ...extraFilter,
    _id: jobId,
    status: { $eq: expectedStatus, $ne: 'Awaiting Approval' },
    currentEstimate: expectedEstimateId,
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision })
  },
  {
    $set: set,
    $inc: { revision: 1 }
  },
  { returnDocument: 'after' }
);


// Place a parts hold atomically. The job must still be In Repair, still be
// assigned to the same technician, still point at the estimate the service
// validated, and have no active hold. This prevents a concurrent estimate
// revision/reassignment from being overwritten by a stale technician screen.
const placePartsHold = (
  jobId,
  { technicianId, expectedRevision, expectedEstimateId, partsHold }
) => RepairJob.findOneAndUpdate(
  {
    _id: jobId,
    status: 'In Repair',
    assignedTechnician: technicianId,
    currentEstimate: expectedEstimateId,
    'partsHold.active': { $ne: true },
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision })
  },
  {
    $set: {
      status: 'Waiting for Parts',
      partsHold
    },
    $inc: { revision: 1 }
  },
  { returnDocument: 'after' }
);

// Resolve an active parts hold (parts arrived). Status is intentionally left
// unchanged: Waiting for Parts must be explicitly resumed, and Awaiting
// Approval must remain Awaiting Approval until the customer's decision.
const releasePartsHold = (
  jobId,
  { expectedRevision, releasedAt, releasedBy, resolutionNote = null, technicianId = null }
) => RepairJob.findOneAndUpdate(
  {
    _id: jobId,
    'partsHold.active': true,
    status: { $nin: ['Ready for Collection', 'Ready for Return', 'Collected'] },
    ...(technicianId ? { assignedTechnician: technicianId } : {}),
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision })
  },
  {
    $set: {
      'partsHold.active': false,
      'partsHold.releasedAt': releasedAt,
      'partsHold.releasedBy': releasedBy,
      'partsHold.resolutionNote': resolutionNote
    },
    $inc: { revision: 1 }
  },
  { returnDocument: 'after' }
);

// Save-time recheck for a technician progress update: the job must still be
// In Repair under the same approved estimate, with no active parts hold, and
// still assigned to this technician. Does not bump the job revision because a
// progress update is not a workflow state change.
const touchProgressLog = (
  jobId,
  { technicianId, expectedEstimateId, recordedAt },
  session
) => RepairJob.findOneAndUpdate(
  {
    _id: jobId,
    status: 'In Repair',
    currentEstimate: expectedEstimateId,
    assignedTechnician: technicianId,
    'partsHold.active': { $ne: true }
  },
  { $set: { 'repairWork.lastProgressUpdateAt': recordedAt } },
  { returnDocument: 'after', session }
);

// SCRUM-13: atomically begin diagnosis only for the currently assigned
// technician and only while the repair job is still Received.
const startDiagnosis = (
  jobId,
  technicianId,
  expectedRevision,
  startedAt,
  session
) => RepairJob.findOneAndUpdate(
  {
    _id: jobId,
    assignedTechnician: technicianId,
    status: 'Received',
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision })
  },
  {
    $set: {
      status: 'Diagnosing',
      diagnosisState: 'Diagnosing',
      diagnosisStartedAt: startedAt,
      diagnosisStartedBy: technicianId,
      diagnosisRecordedAt: null,
      diagnosisRecordedBy: null
    },
    $inc: { revision: 1 }
  },
  { new: true, session }
);

// Compatibility path for a job already in Diagnosing (for example an older
// branch/test record) that has no SCRUM-13 metadata yet.
const syncDiagnosisStartedMetadata = (
  jobId,
  technicianId,
  expectedRevision,
  startedAt,
  session
) => RepairJob.findOneAndUpdate(
  {
    _id: jobId,
    assignedTechnician: technicianId,
    status: 'Diagnosing',
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision })
  },
  {
    $set: {
      diagnosisState: 'Diagnosing',
      diagnosisStartedAt: startedAt,
      diagnosisStartedBy: technicianId
    },
    $inc: { revision: 1 }
  },
  { new: true, session }
);

// Completing the diagnosis records the second diagnosis-state transition but
// intentionally leaves RepairJob.status as Diagnosing so the already-complete
// SCRUM-14 estimate flow remains unchanged.
const markDiagnosisRecorded = (
  jobId,
  technicianId,
  expectedRevision,
  recordedAt,
  session
) => RepairJob.findOneAndUpdate(
  {
    _id: jobId,
    assignedTechnician: technicianId,
    status: 'Diagnosing',
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision })
  },
  {
    $set: {
      diagnosisState: 'Diagnosis Recorded',
      diagnosisRecordedAt: recordedAt,
      diagnosisRecordedBy: technicianId
    },
    $inc: { revision: 1 }
  },
  { new: true, session }
);

// SCRUM-41: return all jobs assigned to a specific technician, newest first.
// Only expose the fields needed for the technician list view.
const findAssignedToTechnician = (technicianId) =>
  RepairJob.find({ assignedTechnician: technicianId })
    .select('reference deviceType makeModel reportedFault status receivedAt assignedTechnician')
    .sort({ receivedAt: -1 });

const updateStatusForDecision = (
  jobId,
  targetStatus,
  expectedRevision,
  session = null
) => {
  const filter = {
    _id: jobId,
    status: 'Awaiting Approval'
  };

  if (typeof expectedRevision === 'number') {
    filter.revision = expectedRevision;
  }

  return RepairJob.findOneAndUpdate(
    filter,
    {
      $set: { status: targetStatus },
      $inc: { revision: 1 }
    },
    { returnDocument: 'after', session }
  );
};

// SCRUM-104: return all repair jobs belonging to the authenticated customer,
// newest intake first. Only the fields needed for the customer list view are
// projected — no internal diagnosis or staff-only context is included.
const findByCustomer = (customerId) =>
  RepairJob.find({ customer: customerId })
    .select('reference deviceType makeModel serialNumber status receivedAt currentEstimate')
    .sort({ receivedAt: -1 });

// SCRUM-125: return all completed (Collected) repair jobs belonging to the authenticated customer
const findCompletedByCustomer = (customerId) =>
  RepairJob.find({ customer: customerId, status: 'Collected' })
    .sort({ 'collectionDetails.collectedAt': -1, updatedAt: -1 });

// SCRUM-25 / SCRUM-113: Complete repair and move status to Ready for Collection.
// Rechecks atomically that the job is In Repair, assigned to this technician,
// matches the approved estimate and revision, and has no active parts hold.
const completeRepairJob = (
  jobId,
  {
    technicianId,
    expectedRevision,
    expectedEstimateId,
    completionDetails,
    completedAt
  },
  session = null
) => RepairJob.findOneAndUpdate(
  {
    _id: jobId,
    status: 'In Repair',
    assignedTechnician: technicianId,
    currentEstimate: expectedEstimateId,
    'partsHold.active': { $ne: true },
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision })
  },
  {
    $set: {
      status: 'Ready for Collection',
      completionDetails: {
        ...completionDetails,
        completedAt,
        completedBy: technicianId
      }
    },
    $inc: { revision: 1 }
  },
  { returnDocument: 'after', session }
);

// SCRUM-26 / SCRUM-116: Owner/Staff marks a declined or unrepairable device Ready for Return.
// Releases any active parts hold, records return reason, and updates status.
const markJobReadyForReturn = (
  jobId,
  {
    staffId,
    expectedRevision,
    returnDetails,
    returnedAt
  },
  session = null
) => RepairJob.findOneAndUpdate(
  {
    _id: jobId,
    status: { $nin: ['Ready for Return', 'Ready for Collection', 'Collected'] },
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision })
  },
  {
    $set: {
      status: 'Ready for Return',
      'partsHold.active': false,
      'partsHold.releasedAt': returnedAt,
      'partsHold.releasedBy': staffId,
      'partsHold.resolutionNote': 'Parts hold ended due to unrepaired return',
      returnDetails: {
        ...returnDetails,
        returnedAt,
        returnedBy: staffId
      }
    },
    $inc: { revision: 1 }
  },
  { returnDocument: 'after', session }
);

// SCRUM-120: Owner/Staff records customer handover. Sets status to Collected,
// stores the staff member and collection time, confirmation flags, outcome,
// and optional notes. Atomic update guarded by Ready for Collection or Ready for Return.
const recordHandover = (
  jobId,
  {
    staffId,
    outcome,
    notes = null,
    collectedAt,
    customerIdentityConfirmed = true,
    deviceHandedOver = true,
    expectedRevision = null
  },
  session = null
) => {
  const revisionFilter = expectedRevision !== null && expectedRevision !== undefined
    ? (expectedRevision === 0
        ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
        : { revision: expectedRevision })
    : {};

  return RepairJob.findOneAndUpdate(
    {
      _id: jobId,
      status: { $in: ['Ready for Collection', 'Ready for Return'] },
      ...revisionFilter
    },
    {
      $set: {
        status: 'Collected',
        'collectionDetails.collectedAt': collectedAt,
        'collectionDetails.collectedBy': staffId,
        'collectionDetails.customerIdentityConfirmed': customerIdentityConfirmed,
        'collectionDetails.deviceHandedOver': deviceHandedOver,
        'collectionDetails.outcome': outcome,
        'collectionDetails.notes': notes || null
      },
      $inc: { revision: 1 }
    },
    { returnDocument: 'after', session }
  );
};

module.exports = {
  create,
  findByIdempotency,
  findByIdOrReference,
  findByIdForEstimate,
  attachInitialEstimate,
  searchForStaff,
  findForStaffDetail,
  assignTechnician,
  attachRevisedEstimate,
  applyProgressUpdate,
  placePartsHold,
  releasePartsHold,
  touchProgressLog,
  startDiagnosis,
  syncDiagnosisStartedMetadata,
  markDiagnosisRecorded,
  findAssignedToTechnician,
  updateStatusForDecision,
  findByCustomer,
  findCompletedByCustomer,
  completeRepairJob,
  markJobReadyForReturn,
  recordHandover
};
