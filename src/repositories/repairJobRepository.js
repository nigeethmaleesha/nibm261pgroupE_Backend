const RepairJob = require('../models/RepairJob');

const create = (data) => RepairJob.create(data);

const findByIdempotency = (createdBy, idempotencyKey) => RepairJob.findOne({
  createdBy,
  idempotencyKey
}).select('+idempotencyKey +requestHash');


const findByIdOrReference = (identifier, { session = null } = {}) => {
  const value = String(identifier || '').trim();
  const filter = require('mongoose').isValidObjectId(value)
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

module.exports = {
  create,
  findByIdempotency,
  findByIdOrReference,
  findByIdForEstimate,
  attachInitialEstimate
};
