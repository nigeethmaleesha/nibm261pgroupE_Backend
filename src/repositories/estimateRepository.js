const Estimate = require('../models/Estimate');
const EstimateItem = require('../models/EstimateItem');

const findInitialByJob = (jobId, { includeRequestHash = false, session = null } = {}) => {
  let query = Estimate.findOne({ job: jobId, versionNumber: 1 });
  if (includeRequestHash) query = query.select('+requestHash');
  if (session) query = query.session(session);
  return query;
};

const findById = (estimateId, { session = null } = {}) => {
  let query = Estimate.findById(estimateId);
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

module.exports = {
  findInitialByJob,
  findById,
  listItems,
  createEstimate,
  createItems
};
