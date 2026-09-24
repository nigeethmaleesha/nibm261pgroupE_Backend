const repairJobService = require('../services/repairJobService');

const lookupCustomers = async (req, res, next) => {
  try {
    const customers = await repairJobService.lookupCustomers(req.query.query, req.query.limit);
    return res.status(200).json({
      count: customers.length,
      customers
    });
  } catch (error) {
    return next(error);
  }
};

const createRepairJob = async (req, res, next) => {
  try {
    const result = await repairJobService.createRepairJob({
      payload: req.body,
      idempotencyKey: req.get('Idempotency-Key'),
      actor: req.user
    });

    return res.status(result.created ? 201 : 200).json({
      message: result.message,
      idempotentReplay: result.idempotentReplay,
      job: result.job
    });
  } catch (error) {
    return next(error);
  }
};

// SCRUM-41: list all repair jobs assigned to the authenticated technician.
const listMyJobs = async (req, res, next) => {
  try {
    const jobs = await repairJobService.listAssignedJobs(req.user._id);
    return res.status(200).json({
      count: jobs.length,
      jobs
    });
  } catch (error) {
    return next(error);
  }
};

// SCRUM-41: get full details of one job assigned to the authenticated technician.
const getMyJob = async (req, res, next) => {
  try {
    const job = await repairJobService.getAssignedJobDetail(
      req.params.jobIdentifier,
      req.user._id
    );
    return res.status(200).json({ job });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  lookupCustomers,
  createRepairJob,
  listMyJobs,
  getMyJob
};
