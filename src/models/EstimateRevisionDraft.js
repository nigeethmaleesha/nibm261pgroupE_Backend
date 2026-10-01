const mongoose = require('mongoose');

/*
 * Estimate revision draft. Drafts live in their own collection so they can never
 * be picked up as the current or latest issued estimate, and they never change
 * the job status or the approved scope of work. One draft is kept per job.
 */
const draftItemSchema = new mongoose.Schema(
  {
    lineNumber: {
      type: Number,
      required: true,
      min: 1
    },
    type: {
      type: String,
      enum: ['PART', 'LABOUR'],
      required: true
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    unitPriceMinor: {
      type: Number,
      required: true,
      min: 0
    },
    lineTotalMinor: {
      type: Number,
      required: true,
      min: 0
    }
  },
  { _id: false }
);

const estimateRevisionDraftSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RepairJob',
      required: true,
      immutable: true
    },
    // The issued version this draft was prepared against. Issuing a stale draft
    // is rejected so staff always revise the estimate the customer last saw.
    baseEstimate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Estimate',
      required: true
    },
    baseVersionNumber: {
      type: Number,
      required: true,
      min: 1
    },
    changeReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null
    },
    currency: {
      type: String,
      enum: ['LKR'],
      default: 'LKR',
      required: true
    },
    items: {
      type: [draftItemSchema],
      default: []
    },
    totalMinor: {
      type: Number,
      required: true,
      min: 1
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true,
    collection: 'estimate_revision_drafts'
  }
);

estimateRevisionDraftSchema.index(
  { job: 1 },
  { unique: true, name: 'unique_estimate_revision_draft_job' }
);

module.exports = mongoose.model('EstimateRevisionDraft', estimateRevisionDraftSchema);
