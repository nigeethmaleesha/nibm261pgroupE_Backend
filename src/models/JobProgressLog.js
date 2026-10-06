const mongoose = require('mongoose');

/*
 * Technician progress log while a job is In Repair (collection job_progress_logs).
 *
 * Each submit stores two rows that share one `entryId`:
 * - is_public: false -> the internal work note (technician/staff only).
 * - is_public: true  -> the customer-safe progress update.
 * Customer APIs only ever read rows where is_public is true.
 *
 * Rows are immutable. A mistake is fixed by a new entry whose rows point to
 * the original entry through `correctionOf` and explain it in `correctionReason`.
 */
const jobProgressLogSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RepairJob',
      required: true,
      immutable: true
    },
    // Links the private and public rows written by the same submit.
    entryId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true
    },
    is_public: {
      type: Boolean,
      required: true,
      immutable: true
    },
    text: {
      type: String,
      trim: true,
      required: true,
      minlength: 1,
      maxlength: 2000,
      immutable: true
    },
    // The latest approved estimate that authorised this entry.
    estimate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Estimate',
      required: true,
      immutable: true
    },
    estimateVersionNumber: {
      type: Number,
      required: true,
      immutable: true
    },
    jobStatus: {
      type: String,
      required: true,
      immutable: true
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    recordedByRole: {
      type: String,
      enum: ['technician'],
      required: true,
      immutable: true
    },
    // entryId of the entry this one corrects.
    correctionOf: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      immutable: true
    },
    // Internal only; never returned to customers.
    correctionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
      immutable: true
    },
    // Safe retry: the same Idempotency-Key replays the saved entry instead of
    // creating a duplicate. requestHash detects a key reused with new content.
    idempotencyKey: {
      type: String,
      required: true,
      select: false,
      immutable: true
    },
    requestHash: {
      type: String,
      required: true,
      select: false,
      immutable: true
    }
  },
  {
    timestamps: true,
    collection: 'job_progress_logs'
  }
);

jobProgressLogSchema.index(
  { job: 1, createdAt: -1 },
  { name: 'job_progress_log_job_created_idx' }
);

// Customer timeline: public rows only.
jobProgressLogSchema.index(
  { job: 1, is_public: 1, createdAt: -1 },
  { name: 'job_progress_log_job_public_idx' }
);

// Exactly one private and one public row per entry.
jobProgressLogSchema.index(
  { entryId: 1, is_public: 1 },
  { unique: true, name: 'unique_job_progress_log_entry_visibility' }
);

// One entry per Idempotency-Key (per technician and job).
jobProgressLogSchema.index(
  { recordedBy: 1, job: 1, idempotencyKey: 1, is_public: 1 },
  { unique: true, name: 'unique_job_progress_log_idempotency' }
);

// One correction per entry; later fixes correct the correction instead.
jobProgressLogSchema.index(
  { correctionOf: 1, is_public: 1 },
  {
    unique: true,
    name: 'unique_job_progress_log_correction',
    partialFilterExpression: { correctionOf: { $type: 'objectId' } }
  }
);

// SCRUM-120: Technician work progress logs are immutable and read-only.
jobProgressLogSchema.pre(
  ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove', 'updateOne', 'updateMany', 'findOneAndUpdate'],
  function () {
    throw new Error('Technician work progress logs are immutable and read-only.');
  }
);

module.exports = mongoose.model('JobProgressLog', jobProgressLogSchema);
