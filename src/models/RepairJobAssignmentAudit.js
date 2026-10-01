const mongoose = require('mongoose');

const repairJobAssignmentAuditSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RepairJob',
      required: true,
      immutable: true
    },
    action: {
      type: String,
      enum: ['ASSIGNED', 'REASSIGNED'],
      required: true,
      immutable: true
    },
    previousTechnician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      immutable: true
    },
    assignedTechnician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    assignedAt: {
      type: Date,
      required: true,
      immutable: true
    },
    jobStatus: {
      type: String,
      required: true,
      immutable: true
    }
  },
  {
    timestamps: true,
    collection: 'repair_job_assignment_audits'
  }
);

repairJobAssignmentAuditSchema.index(
  { job: 1, assignedAt: -1 },
  { name: 'repair_job_assignment_audit_job_idx' }
);
repairJobAssignmentAuditSchema.index(
  { assignedTechnician: 1, assignedAt: -1 },
  { name: 'repair_job_assignment_audit_technician_idx' }
);
repairJobAssignmentAuditSchema.index(
  { assignedBy: 1, assignedAt: -1 },
  { name: 'repair_job_assignment_audit_staff_idx' }
);

module.exports = mongoose.model(
  'RepairJobAssignmentAudit',
  repairJobAssignmentAuditSchema
);
