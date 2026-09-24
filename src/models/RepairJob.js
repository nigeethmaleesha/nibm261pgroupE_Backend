const mongoose = require('mongoose');

const JOB_STATUSES = [
  'Received',
  'Diagnosing',
  'Awaiting Approval',
  'Approved',
  'In Repair',
  'Waiting for Parts',
  'Ready for Collection',
  'Ready for Return',
  'Collected'
];

const customerSnapshotSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254
    },
    contactNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30
    }
  },
  { _id: false }
);

const repairJobSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      immutable: true,
      maxlength: 32
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    customerSnapshot: {
      type: customerSnapshotSchema,
      required: true,
      immutable: true
    },
    deviceType: {
      type: String,
      required: [true, 'Device type is required'],
      trim: true,
      maxlength: 80
    },
    makeModel: {
      type: String,
      required: [true, 'Make/model is required'],
      trim: true,
      maxlength: 160
    },
    serialNumber: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null
    },
    reportedFault: {
      type: String,
      required: [true, 'Reported fault is required'],
      trim: true,
      maxlength: 2000
    },
    receivedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true
    },
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: 'Received',
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    // SCRUM-14: points at the latest issued estimate. Keeping this on the job
    // makes future current-estimate/history stories deterministic.
    currentEstimate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Estimate',
      default: null
    },
    // Optimistic revision used when workflow commands change the job state.
    revision: {
      type: Number,
      default: 0,
      min: 0
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      immutable: true,
      select: false
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
    collection: 'repair_jobs'
  }
);

// SCRUM-9: the display reference must never be duplicated.
repairJobSchema.index(
  { reference: 1 },
  { unique: true, name: 'unique_repair_job_reference' }
);

// The same Owner/Staff request key may only create one repair job. The service
// compares requestHash before replaying the saved result so a changed payload
// cannot silently reuse an old key.
repairJobSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  { unique: true, name: 'unique_repair_job_intake_idempotency' }
);

repairJobSchema.index(
  { customer: 1, receivedAt: -1 },
  { name: 'repair_job_customer_received_idx' }
);
repairJobSchema.index(
  { status: 1, receivedAt: -1 },
  { name: 'repair_job_status_received_idx' }
);

module.exports = mongoose.model('RepairJob', repairJobSchema);
module.exports.JOB_STATUSES = JOB_STATUSES;
