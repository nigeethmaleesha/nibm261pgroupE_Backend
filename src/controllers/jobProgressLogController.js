const jobProgressLogService = require('../services/jobProgressLogService');

const recordProgressUpdate = async (req, res, next) => {
  try {
    const result = await jobProgressLogService.recordProgressUpdate({
      jobIdentifier: req.params.jobIdentifier,
      payload: req.body,
      idempotencyKey: req.get('Idempotency-Key'),
      actor: req.user
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
};

const listProgressUpdates = async (req, res, next) => {
  try {
    const result = await jobProgressLogService.listProgressUpdates({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const listCustomerProgressUpdates = async (req, res, next) => {
  try {
    const result = await jobProgressLogService.listCustomerProgressUpdates({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  recordProgressUpdate,
  listProgressUpdates,
  listCustomerProgressUpdates
};
