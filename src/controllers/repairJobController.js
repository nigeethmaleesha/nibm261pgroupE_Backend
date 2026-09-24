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


// SCRUM-10: Owner/Staff shop-wide search by reference, customer name or phone.
const searchStaffJobs = async (req, res, next) => {
  try {
    const jobs = await repairJobService.searchStaffRepairJobs({
      queryValue: req.query.query,
      limitValue: req.query.limit,
      actor: req.user
    });

    return res.status(200).json({
      count: jobs.length,
      jobs
    });
  } catch (error) {
    return next(error);
  }
};

// SCRUM-10: Owner/Staff detail view for one repair job.
const getStaffJob = async (req, res, next) => {
  try {
    const job = await repairJobService.getStaffRepairJobDetail({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });

    return res.status(200).json({ job });
  } catch (error) {
    return next(error);
  }
};

// SCRUM-11: Owner/Staff technician assignment with workflow/audit checks.
const assignTechnician = async (req, res, next) => {
  try {
    const result = await repairJobService.assignRepairJob({
      jobIdentifier: req.params.jobIdentifier,
      payload: req.body,
      actor: req.user
    });

    return res.status(200).json(result);
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
  searchStaffJobs,
  getStaffJob,
  assignTechnician,
  listMyJobs,
  getMyJob
};
