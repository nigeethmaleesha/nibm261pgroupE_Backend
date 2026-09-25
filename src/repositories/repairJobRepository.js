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

// Estimate revision: move currentEstimate to the new version and send the job
// back to Awaiting Approval. The filter pins the job to the state the service
// validated (status, previous estimate and revision) so a concurrent decision or
// revision makes this update miss instead of overwriting it. An existing parts
// hold is never cleared here; `partsHold` is only passed to place a new one.
const attachRevisedEstimate = (
  jobId,
  {
    previousEstimateId,
    estimateId,
    expectedStatus,
    expectedRevision,
    partsHold = null
  },
  session
) => {
  const $set = {
    currentEstimate: estimateId,
    status: 'Awaiting Approval'
  };
  if (partsHold) $set.partsHold = partsHold;

  return RepairJob.findOneAndUpdate(
    {
      _id: jobId,
      status: expectedStatus,
      currentEstimate: previousEstimateId,
      ...(expectedRevision === 0
        ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
        : { revision: expectedRevision })
    },
    {
      $set,
      $inc: { revision: 1 }
    },
    { returnDocument: 'after', session }
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
  attachRevisedEstimate,
  findAssignedToTechnician,
  updateStatusForDecision
};
