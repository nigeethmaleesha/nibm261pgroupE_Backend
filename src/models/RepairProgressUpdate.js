const mongoose = require('mongoose');

/*
 * Repair progress log. One immutable entry per accepted progress update so the
 * job keeps an audit trail of status changes and technician/staff notes.
 */
const repairProgressUpdateSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RepairJob',
      required: true,
      immutable: true
    },
    fromStatus: {
      type: String,
      required: true,
      immutable: true
    },
    toStatus: {
      type: String,
      required: true,
      immutable: true
    },
    note: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
      immutable: true
    },
    // The approved estimate version that authorised this update.
    estimateVersionNumber: {
      type: Number,
      default: null,
      immutable: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    updatedByRole: {
      type: String,
      enum: ['owner_staff', 'technician'],
      required: true,
      immutable: true
    }
  },
  {
    timestamps: true,
    collection: 'repair_progress_updates'
  }
);

repairProgressUpdateSchema.index(
  { job: 1, createdAt: -1 },
  { name: 'repair_progress_job_created_idx' }
);

module.exports = mongoose.model('RepairProgressUpdate', repairProgressUpdateSchema);
