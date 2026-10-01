const diagnosisService = require('../services/diagnosisService');

const getTechnicianDiagnosis = async (req, res, next) => {
  try {
    const result = await diagnosisService.getTechnicianDiagnosis({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const startDiagnosis = async (req, res, next) => {
  try {
    const result = await diagnosisService.startDiagnosis({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(result.started ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
};

const saveDiagnosis = async (req, res, next) => {
  try {
    const result = await diagnosisService.saveDiagnosis({
      jobIdentifier: req.params.jobIdentifier,
      payload: req.body,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const getStaffDiagnosis = async (req, res, next) => {
  try {
    const result = await diagnosisService.getStaffDiagnosis({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const getCustomerDiagnosis = async (req, res, next) => {
  try {
    const result = await diagnosisService.getCustomerDiagnosis({
      jobIdentifier: req.params.jobIdentifier,
      actor: req.user
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getTechnicianDiagnosis,
  startDiagnosis,
  saveDiagnosis,
  getStaffDiagnosis,
  getCustomerDiagnosis
};
