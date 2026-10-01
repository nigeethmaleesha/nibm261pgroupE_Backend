// SCRUM-104: customer job list controller.
const repairJobService = require('../services/repairJobService');

// GET /api/customer/my-jobs
// Returns all repair jobs that belong to the authenticated customer.
// The service layer enforces ownership; the controller only passes the
// authenticated user's ID so no cross-customer data can ever leak.
const listMyJobs = async (req, res, next) => {
  try {
    const jobs = await repairJobService.listMyJobsForCustomer(req.user._id);
    return res.status(200).json({
      count: jobs.length,
      jobs
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listMyJobs
};
