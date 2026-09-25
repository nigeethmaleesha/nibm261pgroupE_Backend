const { assertRepairWorkAllowedForJob } = require('../services/repairAuthorisationService');

/*
 * Estimate revision guard for repair-progress routes. Mount it on any route that
 * starts/continues repair work ('REPAIR') or completes a repair ('COMPLETE') so
 * the job cannot move forward until the latest estimate version is approved.
 *
 * Example:
 * router.patch('/jobs/:jobIdentifier/complete', protect,
 *   requireApprovedLatestEstimate('COMPLETE'), handler)
 */
const requireApprovedLatestEstimate = (action = 'REPAIR') => async (req, res, next) => {
  try {
    const jobIdentifier = req.params.jobIdentifier || req.params.id || req.params.jobId;
    req.authorizedJob = await assertRepairWorkAllowedForJob(jobIdentifier, action);
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { requireApprovedLatestEstimate };
