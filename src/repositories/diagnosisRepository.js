const Diagnosis = require('../models/Diagnosis');

const findByJob = (jobId, { session = null } = {}) => {
  let query = Diagnosis.findOne({ job: jobId });
  if (session) query = query.session(session);
  return query;
};

const findCompletedByJob = (jobId, { session = null } = {}) => {
  let query = Diagnosis.findOne({
    job: jobId,
    $or: [
      { completedAt: { $ne: null } },
      { isCompleted: true },
      { diagnosisCompleted: true }
    ]
  });
  if (session) query = query.session(session);
  return query;
};

// One repair job owns one diagnosis record. $setOnInsert makes Start Diagnosis
// idempotent if the technician double-clicks or retries after a network error.
const startForJob = ({ jobId, technicianId, startedAt }, session = null) =>
  Diagnosis.findOneAndUpdate(
    { job: jobId },
    {
      $setOnInsert: {
        job: jobId,
        state: 'Diagnosing',
        findings: '',
        recommendedWork: '',
        publicSummary: '',
        internalNotes: '',
        isUnrepairable: false,
        unrepairableReason: null,
        startedAt,
        startedBy: technicianId,
        lastUpdatedBy: technicianId,
        completedAt: null,
        completedBy: null,
        isCompleted: false,
        diagnosisCompleted: false
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      session
    }
  );

const saveDraft = (jobId, set, session = null) =>
  Diagnosis.findOneAndUpdate(
    {
      job: jobId,
      completedAt: null,
      isCompleted: { $ne: true },
      diagnosisCompleted: { $ne: true }
    },
    { $set: set },
    { new: true, session }
  );

const complete = (jobId, set, session) =>
  Diagnosis.findOneAndUpdate(
    {
      job: jobId,
      completedAt: null,
      isCompleted: { $ne: true },
      diagnosisCompleted: { $ne: true }
    },
    {
      $set: {
        ...set,
        state: 'Diagnosis Recorded',
        isCompleted: true,
        diagnosisCompleted: true
      }
    },
    { new: true, session }
  );

module.exports = {
  findByJob,
  findCompletedByJob,
  startForJob,
  saveDraft,
  complete
};
