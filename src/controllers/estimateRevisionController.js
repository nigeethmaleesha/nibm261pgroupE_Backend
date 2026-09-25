const estimateRevisionService = require('../services/estimateRevisionService');

const getEstimateHistory = async (req, res, next) => {
  try {
    const result = await estimateRevisionService.getEstimateHistory({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const getRevisionDraft = async (req, res, next) => {
  try {
    const result = await estimateRevisionService.getRevisionDraft({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const saveRevisionDraft = async (req, res, next) => {
  try {
    const result = await estimateRevisionService.saveRevisionDraft({
      jobIdentifier: req.params.jobIdentifier,
      payload: req.body,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const discardRevisionDraft = async (req, res, next) => {
  try {
    const result = await estimateRevisionService.discardRevisionDraft({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const issueRevisedEstimate = async (req, res, next) => {
  try {
    const result = await estimateRevisionService.issueRevisedEstimate({
      jobIdentifier: req.params.jobIdentifier,
      payload: req.body,
      actor: req.user
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getEstimateHistory,
  getRevisionDraft,
  saveRevisionDraft,
  discardRevisionDraft,
  issueRevisedEstimate
};
