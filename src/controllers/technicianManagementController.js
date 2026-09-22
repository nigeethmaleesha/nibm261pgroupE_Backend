const technicianManagementService = require('../services/technicianManagementService');
const internalAuthService = require('../services/internalAuthService');

const createTechnician = async (req, res, next) => {
  try {
    const result = await technicianManagementService.createTechnician(req.body);
    return res.status(202).json(result);
  } catch (error) {
    return next(error);
  }
};

const listTechnicians = async (req, res, next) => {
  try {
    const technicians = await technicianManagementService.listTechnicians(req.query.status);
    return res.status(200).json({
      count: technicians.length,
      technicians
    });
  } catch (error) {
    return next(error);
  }
};

const toggleTechnicianActive = async (req, res, next) => {
  try {
    const result = await technicianManagementService.toggleTechnicianActive(
      req.params.technicianId
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};


const verifyTechnicianOtp = async (req, res, next) => {
  try {
    const result = await internalAuthService.verifyTechnicianActivationOtp(req.body);
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
};

const resendTechnicianOtp = async (req, res, next) => {
  try {
    const result = await internalAuthService.resendTechnicianActivationOtp(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createTechnician,
  listTechnicians,
  toggleTechnicianActive,
  verifyTechnicianOtp,
  resendTechnicianOtp
};
