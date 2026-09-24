const mongoose = require('mongoose');
const RepairJob = require('../models/RepairJob');

const create = (data) => RepairJob.create(data);

const findByIdempotency = (createdBy, idempotencyKey) => RepairJob.findOne({
  createdBy,
  idempotencyKey
}).select('+idempotencyKey +requestHash');

const identifierFilter = (identifier) => {
  const value = String(identifier || '').trim();
  return mongoose.isValidObjectId(value)
    ? { _id: value }
    : { reference: value.toUpperCase() };
};

const findByIdOrReference = (identifier, { session = null } = {}) => {
  let query = RepairJob.findOne(identifierFilter(identifier));
  if (session) query = query.session(session);
  return query;
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

module.exports = {
  create,
  findByIdempotency,
  findByIdOrReference,
  findByIdForEstimate,
  attachInitialEstimate,
  searchForStaff,
  findForStaffDetail,
  assignTechnician,
  findAssignedToTechnician,
  updateStatusForDecision
};
