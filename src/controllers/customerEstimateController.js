const customerEstimateService = require('../services/customerEstimateService');

const getCurrentEstimate = async (req, res, next) => {
  try {
    const result = await customerEstimateService.getCurrentEstimate({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCurrentEstimate
};
