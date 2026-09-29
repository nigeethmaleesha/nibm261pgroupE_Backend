const mongoose = require('mongoose');

const JOB_STATUSES = [
  'Received',
  'Diagnosing',
  'Awaiting Approval',
  'Approved',
  'Estimate Rejected',
  'In Repair',
  'Waiting for Parts',
  'Ready for Collection',
  'Ready for Return',
  'Collected'
];

// Estimate revision: a revised estimate cannot be issued once the job has
// reached one of these end-of-repair states.
const REVISION_BLOCKED_STATUSES = [
  'Ready for Collection',
  'Ready for Return',
  'Collected'
];

// A parts hold is tracked separately from status so that it survives a status
// change such as Waiting for Parts -> Awaiting Approval during a revision.
const partsHoldSchema = new mongoose.Schema(
  {
    active: {
      type: Boolean,
      default: false
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null
    },
    placedAt: {
      type: Date,
      default: null
    },
    releasedAt: {
      type: Date,
      default: null
    },
    releasedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  { _id: false }
);

const repairWorkSchema = new mongoose.Schema(
  {
    firstStartedAt: {
      type: Date,
      default: null
    },
    firstStartedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    lastAction: {
      type: String,
      enum: ['START', 'RESUME', null],
      default: null
    },
    lastStartedAt: {
      type: Date,
      default: null
    },
    lastStartedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    approvedEstimate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Estimate',
      default: null
    },
    approvedEstimateVersion: {
      type: Number,
      default: null
    }
  },
  { _id: false }
);

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
    // SCRUM-41: technician assigned to this job. Null until assignment is made.
    assignedTechnician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // SCRUM-11: records which Owner/Staff member made the latest assignment.
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    assignedAt: {
      type: Date,
      default: null
    },
    // SCRUM-13: diagnosis lifecycle metadata is additive to the existing
    // repair workflow status. The global status remains `Diagnosing` after
    // completion so SCRUM-14 estimate issuance keeps its existing contract.
    diagnosisState: {
      type: String,
      enum: ['Not Started', 'Diagnosing', 'Diagnosis Recorded'],
      default: 'Not Started'
    },
    diagnosisStartedAt: {
      type: Date,
      default: null
    },
    diagnosisStartedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    diagnosisRecordedAt: {
      type: Date,
      default: null
    },
    diagnosisRecordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
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
    partsHold: {
      type: partsHoldSchema,
      default: () => ({})
    },
    // Start/resume repair: who moved the job into In Repair, when, and under
    // which approved estimate version. First start is kept; the last* fields
    // are overwritten on every start or resume.
    repairWork: {
      type: repairWorkSchema,
      default: () => ({})
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

// SCRUM-10: searchable staff job list. Reference already has a unique index;
// these two indexes support the customer-name / contact-number search fields.
repairJobSchema.index(
  { 'customerSnapshot.fullName': 1 },
  { name: 'repair_job_customer_name_search_idx' }
);
repairJobSchema.index(
  { 'customerSnapshot.contactNumber': 1 },
  { name: 'repair_job_customer_phone_search_idx' }
);

// SCRUM-41: fast lookup of all jobs assigned to a specific technician.
repairJobSchema.index(
  { assignedTechnician: 1, receivedAt: -1 },
  { name: 'repair_job_assigned_technician_idx' }
);

module.exports = mongoose.model('RepairJob', repairJobSchema);
module.exports.JOB_STATUSES = JOB_STATUSES;
module.exports.REVISION_BLOCKED_STATUSES = REVISION_BLOCKED_STATUSES;
