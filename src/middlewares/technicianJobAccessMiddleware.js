/*
 * Reusable SCRUM-41 ownership guard for the repair-job module.
 *
 * The current uploaded backend does not yet contain a Job model/routes, so this
 * middleware intentionally accepts a `loadJobById` function instead of importing
 * a Job model that belongs to another team member. This keeps the auth branch
 * merge-safe. Mount it on /api/jobs/:id routes when that module is merged.
 *
 * Example:
 * router.get('/:id', protect, requireAssignedTechnician((id) => Job.findById(id)), handler)
 */
const requireAssignedTechnician = (loadJobById) => {
  if (typeof loadJobById !== 'function') {
    throw new TypeError('requireAssignedTechnician requires a loadJobById function');
  }

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      if (req.user.role === 'owner_staff') {
        return next();
      }

      if (req.user.role !== 'technician') {
        return res.status(403).json({ message: 'You do not have permission to access this job' });
      }

      const jobId = req.params.id || req.params.jobId;
      const job = await loadJobById(jobId);

      if (!job) {
        return res.status(404).json({ message: 'Repair job not found' });
      }

      const assigned = job.assignedTechnician?._id ||
        job.assignedTechnician ||
        job.technicianId?._id ||
        job.technicianId;

      if (!assigned || String(assigned) !== String(req.user._id)) {
        return res.status(403).json({ message: 'You do not have permission to access this job' });
      }

      req.authorizedJob = job;
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = { requireAssignedTechnician };
