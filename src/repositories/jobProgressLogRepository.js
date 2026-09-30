const JobProgressLog = require('../models/JobProgressLog');

// Inserts the private + public rows of one entry.
const createRows = (rows, session) => JobProgressLog.insertMany(rows, { session, ordered: true });

const findByIdempotency = (recordedBy, jobId, idempotencyKey) => JobProgressLog.find({
  recordedBy,
  job: jobId,
  idempotencyKey
}).select('+requestHash');

const findEntryRows = (entryId, jobId, { session } = {}) => JobProgressLog.find({
  entryId,
  job: jobId
}).session(session || null);

const findCorrectionOf = (entryId, { session } = {}) => JobProgressLog.findOne({
  correctionOf: entryId
}).session(session || null);

// Internal view: private and public rows.
const listByJob = (jobId) => JobProgressLog.find({ job: jobId })
  .sort({ createdAt: -1, _id: -1 })
  .populate('recordedBy', 'fullName');

// Customer view: public rows only, filtered in the database.
const listPublicByJob = (jobId) => JobProgressLog.find({ job: jobId, is_public: true })
  .sort({ createdAt: -1, _id: -1 });

module.exports = {
  createRows,
  findByIdempotency,
  findEntryRows,
  findCorrectionOf,
  listByJob,
  listPublicByJob
};
