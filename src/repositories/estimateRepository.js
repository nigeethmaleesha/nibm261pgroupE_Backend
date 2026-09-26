const Estimate = require('../models/Estimate');
const EstimateItem = require('../models/EstimateItem');

const findInitialByJob = (jobId, { includeRequestHash = false, session = null } = {}) => {
  let query = Estimate.findOne({ job: jobId, versionNumber: 1 });
  if (includeRequestHash) query = query.select('+requestHash');
  if (session) query = query.session(session);
  return query;
};

const findById = (estimateId, { includeRequestHash = false, session = null } = {}) => {
  let query = Estimate.findById(estimateId);
  if (includeRequestHash) query = query.select('+requestHash');
  if (session) query = query.session(session);
  return query;
};

// The job's currentEstimate pointer is the source of truth for the latest
// issued version. Jobs issued before the pointer existed fall back to version 1.
const findCurrentByJob = (job, options = {}) => (
  job.currentEstimate
    ? findById(job.currentEstimate, options)
    : findInitialByJob(job._id, options)
);

const findLatestApprovedByJob = (jobId, { session = null } = {}) => {
  let query = Estimate.findOne({
    job: jobId,
    $or: [{ status: 'Approved' }, { 'decision.action': 'APPROVED' }]
  }).sort({ versionNumber: -1 });
  if (session) query = query.session(session);
  return query;
};

const listByJob = (jobId, { session = null } = {}) => {
  let query = Estimate.find({ job: jobId }).sort({ versionNumber: 1 });
  if (session) query = query.session(session);
  return query;
};

const listItems = (estimateId, { session = null } = {}) => {
  let query = EstimateItem.find({ estimate: estimateId }).sort({ lineNumber: 1 });
  if (session) query = query.session(session);
  return query;
};

const createEstimate = async (data, session) => {
  const [estimate] = await Estimate.create([data], { session });
  return estimate;
};

const createItems = (items, session) => EstimateItem.insertMany(items, {
  session,
  ordered: true
});

const recordDecision = (
  estimateId,
  { status, action, decidedBy, decidedAt },
  session = null
) => {
  let query = Estimate.findOneAndUpdate(
    {
      _id: estimateId,
      status: 'Issued',
      'decision.action': null
    },
    {
      $set: {
        status,
        'decision.action': action,
        'decision.decidedBy': decidedBy,
        'decision.decidedAt': decidedAt
      }
    },
    { returnDocument: 'after' }
  );

  if (session) query = query.session(session);
  return query;
};

// Estimate revision: link the replaced version to its successor. Only an
// undecided version changes status; an Approved/Rejected decision is kept as-is.
const markSuperseded = async (estimateId, { supersededBy, supersededAt }, session = null) => {
  const options = session ? { session } : {};

  await Estimate.updateOne(
    { _id: estimateId, supersededBy: null },
    { $set: { supersededBy, supersededAt } },
    options
  );
  await Estimate.updateOne(
    { _id: estimateId, status: 'Issued', 'decision.action': null },
    { $set: { status: 'Superseded' } },
    options
  );
};

module.exports = {
  findInitialByJob,
  findById,
  findCurrentByJob,
  findLatestApprovedByJob,
  listByJob,
  listItems,
  createEstimate,
  createItems,
  recordDecision,
  markSuperseded
};
