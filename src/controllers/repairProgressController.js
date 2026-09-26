const repairProgressService = require('../services/repairProgressService');

const updateProgress = async (req, res, next) => {
  try {
    const result = await repairProgressService.updateProgress({
      jobIdentifier: req.params.jobIdentifier,
      payload: req.body,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const getProgressHistory = async (req, res, next) => {
  try {
    const result = await repairProgressService.getProgressHistory({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  updateProgress,
  getProgressHistory
};
