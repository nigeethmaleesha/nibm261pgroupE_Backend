const mongoose = require('mongoose');
const staffDashboardRepository = require('../repositories/staffDashboardRepository');
const userRepository = require('../repositories/userRepository');

const { WORKLOAD_STATUSES } = staffDashboardRepository;

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseDateOnly = (value, fieldName) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;

  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createHttpError(`${fieldName} must use YYYY-MM-DD format`, 400);
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw createHttpError(`${fieldName} must be a valid calendar date`, 400);
  }

  return parsed;
};

const normalizeFilters = (query = {}) => {
  const technicianRaw = String(query.technicianId || '').trim();
  const statusRaw = String(query.status || '').trim();
  const dateFrom = parseDateOnly(query.dateFrom, 'dateFrom');
  const dateTo = parseDateOnly(query.dateTo, 'dateTo');

  let technicianId = null;
  if (technicianRaw && technicianRaw.toUpperCase() !== 'ALL') {
    if (!mongoose.isValidObjectId(technicianRaw)) {
      throw createHttpError('technicianId must be a valid MongoDB ObjectId', 400);
    }
    technicianId = technicianRaw;
  }

  let status = null;
  if (statusRaw && statusRaw.toUpperCase() !== 'ALL') {
    if (!WORKLOAD_STATUSES.includes(statusRaw)) {
      throw createHttpError(
        `status must be one of: ${WORKLOAD_STATUSES.join(', ')}`,
        400
      );
    }
    status = statusRaw;
  }

  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
    throw createHttpError('dateFrom cannot be after dateTo', 400);
  }

  const dateToExclusive = dateTo
    ? new Date(dateTo.getTime() + 24 * 60 * 60 * 1000)
    : null;

  return {
    technicianId,
    status,
    dateFrom,
    dateTo,
    dateToExclusive
  };
};

const emptyCounts = () => WORKLOAD_STATUSES.reduce((counts, status) => {
  counts[status] = 0;
  return counts;
}, {});

const emptyQueues = () => WORKLOAD_STATUSES.reduce((queues, status) => {
  queues[status] = [];
  return queues;
}, {});

const getDashboardMetrics = async ({ query, actor }) => {
  if (!actor || actor.role !== 'owner_staff') {
    throw createHttpError('Only Owner/Staff can access the shop work dashboard', 403);
  }

  const filters = normalizeFilters(query);

  const [metrics, technicians] = await Promise.all([
    staffDashboardRepository.getDashboardMetrics(filters),
    userRepository.listTechnicians('all')
  ]);

  const counts = emptyCounts();
  for (const group of metrics.counts || []) {
    if (Object.prototype.hasOwnProperty.call(counts, group._id)) {
      counts[group._id] = Number(group.count || 0);
    }
  }

  const queues = emptyQueues();
  for (const job of metrics.jobs || []) {
    if (!Object.prototype.hasOwnProperty.call(queues, job.status)) continue;
    queues[job.status].push({
      ...job,
      device: [job.deviceType, job.makeModel].filter(Boolean).join(' · '),
      assignedTechnician: job.assignedTechnician || null
    });
  }

  return {
    filters: {
      technicianId: filters.technicianId,
      status: filters.status,
      dateFrom: filters.dateFrom ? filters.dateFrom.toISOString().slice(0, 10) : null,
      dateTo: filters.dateTo ? filters.dateTo.toISOString().slice(0, 10) : null
    },
    counts,
    queues,
    technicians: technicians.map((technician) => ({
      id: String(technician._id),
      fullName: technician.fullName,
      isActive: Boolean(technician.isActive)
    })),
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    generatedAt: new Date().toISOString()
  };
};

module.exports = {
  getDashboardMetrics,
  normalizeFilters
};
