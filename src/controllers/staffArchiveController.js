const staffArchiveService = require('../services/staffArchiveService');

/**
 * SCRUM-129 / SCRUM-127: Owner/Staff search and list archived repair records.
 * GET /api/staff/jobs/archived
 */
const searchArchivedJobs = async (req, res, next) => {
  try {
    const result = await staffArchiveService.searchStaffArchivedJobs({
      queryValue: req.query.query,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      outcome: req.query.outcome,
      limitValue: req.query.limit,
      pageValue: req.query.page,
      actor: req.user
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

/**
 * SCRUM-129 / SCRUM-128: Owner/Staff read-only archived job audit dossier.
 * GET /api/staff/jobs/archived/:jobIdentifier (and :id)
 */
const getArchivedJobDetail = async (req, res, next) => {
  try {
    const jobIdentifier = req.params.jobIdentifier || req.params.id;
    const dossier = await staffArchiveService.getStaffArchivedJobDetail({
      jobIdentifier,
      actor: req.user
    });

    return res.status(200).json(dossier);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  searchArchivedJobs,
  getArchivedJobDetail
};
