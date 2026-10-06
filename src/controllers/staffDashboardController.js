const staffDashboardService = require('../services/staffDashboardService');

const getDashboardMetrics = async (req, res, next) => {
  try {
    const dashboard = await staffDashboardService.getDashboardMetrics({
      query: req.query,
      actor: req.user
    });

    return res.status(200).json(dashboard);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getDashboardMetrics
};
