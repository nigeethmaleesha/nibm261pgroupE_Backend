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
  findAssignedToTechnician,
  updateStatusForDecision
};
