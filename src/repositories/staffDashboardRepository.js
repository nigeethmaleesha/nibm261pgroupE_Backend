const mongoose = require('mongoose');
const RepairJob = require('../models/RepairJob');

const WORKLOAD_STATUSES = [
  'Awaiting Approval',
  'Waiting for Parts',
  'Ready for Collection',
  'Ready for Return'
];

const getDashboardMetrics = async ({ technicianId = null, dateFrom = null, dateToExclusive = null, status = null } = {}) => {
  const match = {
    status: status || { $in: WORKLOAD_STATUSES }
  };

  if (technicianId) {
    match.assignedTechnician = new mongoose.Types.ObjectId(technicianId);
  }

  if (dateFrom || dateToExclusive) {
    match.receivedAt = {};
    if (dateFrom) match.receivedAt.$gte = dateFrom;
    if (dateToExclusive) match.receivedAt.$lt = dateToExclusive;
  }

  const [result] = await RepairJob.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'users',
        localField: 'assignedTechnician',
        foreignField: '_id',
        as: 'assignedTechnicianRecord'
      }
    },
    {
      $unwind: {
        path: '$assignedTechnicianRecord',
        preserveNullAndEmptyArrays: true
      }
    },
    { $sort: { receivedAt: -1, _id: -1 } },
    {
      $facet: {
        counts: [
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ],
        jobs: [
          {
            $project: {
              _id: 0,
              id: { $toString: '$_id' },
              reference: 1,
              customer: '$customerSnapshot.fullName',
              deviceType: 1,
              makeModel: 1,
              receivedAt: 1,
              status: 1,
              assignedTechnician: {
                $cond: [
                  { $ifNull: ['$assignedTechnicianRecord._id', false] },
                  {
                    id: { $toString: '$assignedTechnicianRecord._id' },
                    fullName: '$assignedTechnicianRecord.fullName'
                  },
                  null
                ]
              }
            }
          }
        ]
      }
    }
  ]);

  return result || { counts: [], jobs: [] };
};

module.exports = {
  WORKLOAD_STATUSES,
  getDashboardMetrics
};
