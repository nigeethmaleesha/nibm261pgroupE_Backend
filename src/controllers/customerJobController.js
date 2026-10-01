// SCRUM-104: customer job list controller.
const repairJobService = require('../services/repairJobService');

const customerTrackingService = require('../services/customerTrackingService');

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

// SCRUM-109: Customer public repair tracking controller.
// GET /api/customer/jobs/:jobIdentifier/track
// Returns the latest saved status and chronological dated public events sanitized
// of internal notes and technician IDs.
const getJobTracking = async (req, res, next) => {
  try {
    const tracking = await customerTrackingService.getJobTracking({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(tracking);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listMyJobs,
  getJobTracking,
  trackJob: getJobTracking
};
