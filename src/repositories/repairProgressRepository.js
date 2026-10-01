const RepairProgressUpdate = require('../models/RepairProgressUpdate');

const createUpdate = (data) => RepairProgressUpdate.create(data);

const listByJob = (jobId) => RepairProgressUpdate.find({ job: jobId })
  .sort({ createdAt: -1, _id: -1 });

module.exports = {
  createUpdate,
  listByJob
};
