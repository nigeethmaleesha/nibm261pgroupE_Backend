const Estimate = require('../models/Estimate');
const EstimateItem = require('../models/EstimateItem');

// SCRUM-15: customer-facing estimate reads are deliberately isolated from the
// staff estimate context. This repository only loads the issued estimate and
// its public line items; it never reads diagnosis/internal-note collections.
const findLatestIssuedByJob = (jobId) => Estimate.findOne({ job: jobId })
  .sort({ versionNumber: -1, issuedAt: -1, _id: -1 });

const listPublicItems = (estimateId) => EstimateItem.find({ estimate: estimateId })
  .sort({ lineNumber: 1 });

module.exports = {
  findLatestIssuedByJob,
  listPublicItems
};
