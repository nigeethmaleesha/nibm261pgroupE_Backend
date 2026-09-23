const mongoose = require('mongoose');

const estimateSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RepairJob',
      required: true,
      immutable: true
    },
    versionNumber: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'Estimate version must be a whole number'
      },
      immutable: true
    },
    changeReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
      immutable: true
    },
    currency: {
      type: String,
      enum: ['LKR'],
      default: 'LKR',
      required: true,
      immutable: true
    },
    totalMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: 'Estimate total must use integer minor units'
      },
      immutable: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    issuedAt: {
      type: Date,
      required: true,
      immutable: true
    },
    isImmutable: {
      type: Boolean,
      default: true,
      required: true,
      immutable: true
    },
    status: {
      type: String,
      enum: ['Issued', 'Approved', 'Rejected'],
      default: 'Issued',
      required: true
    },
    decision: {
      action: {
        type: String,
        enum: ['APPROVED', 'REJECTED'],
        default: null
      },
      decidedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      },
      decidedAt: {
        type: Date,
        default: null
      }
    },
    requestHash: {
      type: String,
      required: true,
      immutable: true,
      select: false
    }
  },
  {
    timestamps: true,
    collection: 'estimates'
  }
);

estimateSchema.index(
  { job: 1, versionNumber: 1 },
  { unique: true, name: 'unique_estimate_job_version' }
);
estimateSchema.index(
  { job: 1, issuedAt: -1 },
  { name: 'estimate_job_issued_idx' }
);

module.exports = mongoose.model('Estimate', estimateSchema);
