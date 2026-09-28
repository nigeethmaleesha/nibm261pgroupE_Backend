const EstimateRevisionDraft = require('../models/EstimateRevisionDraft');

const findByJob = (jobId, { session = null } = {}) => {
  let query = EstimateRevisionDraft.findOne({ job: jobId });
  if (session) query = query.session(session);
  return query;
};

const upsertForJob = (jobId, { baseEstimate, baseVersionNumber, changeReason, items, totalMinor, actorId }) => (
  EstimateRevisionDraft.findOneAndUpdate(
    { job: jobId },
    {
      $set: {
        baseEstimate,
        baseVersionNumber,
        changeReason,
        currency: 'LKR',
        items,
        totalMinor,
        updatedBy: actorId
      },
      $setOnInsert: {
        job: jobId,
        createdBy: actorId
      }
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  )
);

const deleteByJob = (jobId, session = null) => EstimateRevisionDraft.deleteOne(
  { job: jobId },
  session ? { session } : {}
);

module.exports = {
  findByJob,
  upsertForJob,
  deleteByJob
};
