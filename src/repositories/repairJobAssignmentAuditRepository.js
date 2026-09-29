const RepairJobAssignmentAudit = require('../models/RepairJobAssignmentAudit');

const create = async (data, session = null) => {
  if (session) {
    const [audit] = await RepairJobAssignmentAudit.create([data], { session });
    return audit;
  }
  return RepairJobAssignmentAudit.create(data);
};

const listByJob = (jobId, limit = 20) => RepairJobAssignmentAudit.find({ job: jobId })
  .populate('previousTechnician', 'fullName email contactNumber')
  .populate('assignedTechnician', 'fullName email contactNumber')
  .populate('assignedBy', 'fullName email')
  .sort({ assignedAt: -1, _id: -1 })
  .limit(limit);

module.exports = {
  create,
  listByJob
};
