const mongoose = require('mongoose');

const DIAGNOSIS_STATES = ['Diagnosing', 'Diagnosis Recorded'];

const diagnosisSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RepairJob',
      required: true,
      immutable: true
    },
    state: {
      type: String,
      enum: DIAGNOSIS_STATES,
      default: 'Diagnosing',
      required: true
    },
    findings: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: ''
    },
    recommendedWork: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: ''
    },
    publicSummary: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ''
    },
    // Technician-only / staff-only notes. Customer serializers must never
    // expose this field.
    internalNotes: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: ''
    },
    isUnrepairable: {
      type: Boolean,
      default: false
    },
    unrepairableReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // Kept for compatibility with existing estimate code and branch-safe
    // integrations that recognise any of these completion markers.
    isCompleted: {
      type: Boolean,
      default: false
    },
    diagnosisCompleted: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
    collection: 'diagnoses'
  }
);

diagnosisSchema.index(
  { job: 1 },
  { unique: true, name: 'unique_diagnosis_per_repair_job' }
);

diagnosisSchema.index(
  { startedBy: 1, startedAt: -1 },
  { name: 'diagnosis_started_by_idx' }
);

module.exports = mongoose.model('Diagnosis', diagnosisSchema);
module.exports.DIAGNOSIS_STATES = DIAGNOSIS_STATES;
