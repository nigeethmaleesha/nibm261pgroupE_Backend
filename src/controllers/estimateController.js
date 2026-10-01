const estimateService = require('../services/estimateService');

const getEstimateContext = async (req, res, next) => {
  try {
    const context = await estimateService.getEstimateContext({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(context);
  } catch (error) {
    return next(error);
  }
};

const issueInitialEstimate = async (req, res, next) => {
  try {
    const result = await estimateService.issueInitialEstimate({
      jobIdentifier: req.params.jobIdentifier,
      payload: req.body,
      actor: req.user
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
};

const recordEstimateDecision = async (req, res, next) => {
  try {
    const result = await estimateService.recordEstimateDecision({
      jobIdentifier: req.params.jobIdentifier,
      payload: req.body,
      actor: req.user
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getEstimateContext,
  issueInitialEstimate,
  recordEstimateDecision
};
