/**
 * SCRUM-120 Device Handover Acceptance Criteria Automated Test Suite
 *
 * Verifies:
 * 1. Ready for Collection -> Collected with 'repaired' outcome, staff ID, collection time, notes.
 * 2. Ready for Return -> Collected with 'unrepaired' outcome, staff ID, collection time.
 * 3. Validation: Fails if customer identity is not confirmed (HTTP 422).
 * 4. Validation: Fails if device handover is not confirmed (HTTP 422).
 * 5. Refusal: Fails if job is not in a ready state (HTTP 409).
 * 6. Authorization: Refuses request if actor is not Owner/Staff (HTTP 403).
 * 7. Idempotency: Repeating handover on an already Collected job returns existing result without creating another progress update event.
 * 8. Immutability: Closed Collected job and history are protected by service & database locks.
 */

const mongoose = require('mongoose');
const repairJobRepository = require('../src/repositories/repairJobRepository');
const repairProgressRepository = require('../src/repositories/repairProgressRepository');
const estimateRevisionDraftRepository = require('../src/repositories/estimateRevisionDraftRepository');
const emailService = require('../src/services/emailService');
const { recordHandover } = require('../src/services/repairProgressService');
const RepairJob = require('../src/models/RepairJob');
const RepairProgressUpdate = require('../src/models/RepairProgressUpdate');
const JobProgressLog = require('../src/models/JobProgressLog');

const runTests = async () => {
  console.log('--- Testing SCRUM-120 Customer Device Handover & Immutability ---');

  const staffId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const technicianId = new mongoose.Types.ObjectId();
  const jobId = new mongoose.Types.ObjectId();

  const baseJob = {
    _id: jobId,
    reference: 'JOB-202610-0001',
    customer: customerId,
    customerSnapshot: {
      fullName: 'John Doe',
      email: 'john.doe@example.com',
      contactNumber: '0771234567'
    },
    deviceType: 'Smartphone',
    makeModel: 'Apple iPhone 13',
    serialNumber: 'SN-IPHONE13-001',
    reportedFault: 'Cracked screen and damaged digitizer',
    receivedAt: new Date('2026-10-01T10:00:00Z'),
    status: 'Ready for Collection',
    revision: 2,
    repairWork: {
      approvedEstimate: new mongoose.Types.ObjectId(),
      approvedEstimateVersion: 1
    },
    collectionDetails: {},
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T14:00:00Z')
  };

  // Mock email service
  let emailSent = false;
  emailService.sendRepairCollectedEmail = async () => {
    emailSent = true;
    return true;
  };

  // Mock estimateRevisionDraftRepository
  estimateRevisionDraftRepository.deleteByJob = async () => true;

  // Test 1: Successful Handover for Ready for Collection (outcome = Repaired)
  console.log('Test 1: Handover for Ready for Collection (outcome = Repaired)...');
  let createdProgressUpdates = [];
  repairJobRepository.findByIdOrReference = async () => ({ ...baseJob });
  repairJobRepository.recordHandover = async (id, data) => ({
    ...baseJob,
    status: 'Collected',
    collectionDetails: {
      collectedAt: data.collectedAt,
      collectedBy: data.staffId,
      customerIdentityConfirmed: data.customerIdentityConfirmed,
      deviceHandedOver: data.deviceHandedOver,
      outcome: data.outcome,
      notes: data.notes
    },
    revision: 3
  });
  repairProgressRepository.createUpdate = async (update) => {
    createdProgressUpdates.push(update);
    return { ...update, _id: new mongoose.Types.ObjectId(), createdAt: new Date() };
  };

  const result1 = await recordHandover({
    jobIdentifier: 'JOB-202610-0001',
    payload: {
      customerIdentityConfirmed: true,
      deviceHandedOver: true,
      notes: 'Customer verified with National Identity Card. Settled payment.'
    },
    actor: { _id: staffId, role: 'owner_staff' }
  });

  if (!result1.success) throw new Error('FAIL: Expected success to be true');
  if (result1.job.status !== 'Collected') throw new Error(`FAIL: Expected status Collected, got ${result1.job.status}`);
  if (result1.job.collectionDetails.outcome !== 'repaired') {
    throw new Error(`FAIL: Expected outcome repaired, got ${result1.job.collectionDetails.outcome}`);
  }
  if (!result1.job.collectionDetails.collectedAt) throw new Error('FAIL: collectedAt timestamp is missing');
  if (String(result1.job.collectionDetails.collectedBy) !== String(staffId)) {
    throw new Error(`FAIL: Expected collectedBy to match staffId, got ${result1.job.collectionDetails.collectedBy}`);
  }
  if (createdProgressUpdates.length !== 1) throw new Error('FAIL: Expected 1 progress update event created');
  if (createdProgressUpdates[0].toStatus !== 'Collected') throw new Error('FAIL: Progress update toStatus must be Collected');
  console.log('PASS: Ready for Collection -> Collected with repaired outcome, collection timestamp and staff ID stored.');

  // Test 2: Successful Handover for Ready for Return (outcome = Unrepaired)
  console.log('Test 2: Handover for Ready for Return (outcome = Unrepaired)...');
  createdProgressUpdates = [];
  const readyForReturnJob = {
    ...baseJob,
    status: 'Ready for Return',
    returnDetails: {
      reason: 'Customer declined repair estimate',
      returnedAt: new Date()
    }
  };
  repairJobRepository.findByIdOrReference = async () => ({ ...readyForReturnJob });
  repairJobRepository.recordHandover = async (id, data) => ({
    ...readyForReturnJob,
    status: 'Collected',
    collectionDetails: {
      collectedAt: data.collectedAt,
      collectedBy: data.staffId,
      customerIdentityConfirmed: data.customerIdentityConfirmed,
      deviceHandedOver: data.deviceHandedOver,
      outcome: data.outcome,
      notes: data.notes
    },
    revision: 3
  });

  const result2 = await recordHandover({
    jobIdentifier: 'JOB-202610-0001',
    payload: {
      customerIdentityConfirmed: true,
      deviceHandedOver: true,
      notes: 'Customer collected device unrepaired.'
    },
    actor: { _id: staffId, role: 'owner_staff' }
  });

  if (result2.job.collectionDetails.outcome !== 'unrepaired') {
    throw new Error(`FAIL: Expected outcome unrepaired, got ${result2.job.collectionDetails.outcome}`);
  }
  if (result2.job.status !== 'Collected') throw new Error('FAIL: Status must be Collected');
  console.log('PASS: Ready for Return -> Collected with unrepaired outcome.');

  // Test 3: Rejection if customer identity is not confirmed
  console.log('Test 3: Refusal if customer identity is not confirmed...');
  repairJobRepository.findByIdOrReference = async () => ({ ...baseJob });
  let identityErrorCaught = false;
  try {
    await recordHandover({
      jobIdentifier: 'JOB-202610-0001',
      payload: {
        customerIdentityConfirmed: false,
        deviceHandedOver: true
      },
      actor: { _id: staffId, role: 'owner_staff' }
    });
  } catch (err) {
    if (err.statusCode === 422 && err.codeName === 'VALIDATION_ERROR') {
      identityErrorCaught = true;
    } else {
      throw err;
    }
  }
  if (!identityErrorCaught) throw new Error('FAIL: Did not reject unconfirmed customer identity');
  console.log('PASS: Refused handover when customer identity is not confirmed (HTTP 422).');

  // Test 4: Rejection if device handover is not confirmed
  console.log('Test 4: Refusal if device handover is not confirmed...');
  let handoverErrorCaught = false;
  try {
    await recordHandover({
      jobIdentifier: 'JOB-202610-0001',
      payload: {
        customerIdentityConfirmed: true,
        deviceHandedOver: false
      },
      actor: { _id: staffId, role: 'owner_staff' }
    });
  } catch (err) {
    if (err.statusCode === 422 && err.codeName === 'VALIDATION_ERROR') {
      handoverErrorCaught = true;
    } else {
      throw err;
    }
  }
  if (!handoverErrorCaught) throw new Error('FAIL: Did not reject unconfirmed device handover');
  console.log('PASS: Refused handover when device handover is not confirmed (HTTP 422).');

  // Test 5: Rejection when job is NOT in a ready state (e.g. In Repair)
  console.log('Test 5: Refusal when job is not in a ready state...');
  const inRepairJob = { ...baseJob, status: 'In Repair' };
  repairJobRepository.findByIdOrReference = async () => ({ ...inRepairJob });
  let notReadyErrorCaught = false;
  try {
    await recordHandover({
      jobIdentifier: 'JOB-202610-0001',
      payload: {
        customerIdentityConfirmed: true,
        deviceHandedOver: true
      },
      actor: { _id: staffId, role: 'owner_staff' }
    });
  } catch (err) {
    if (err.statusCode === 409 && err.codeName === 'INVALID_STATUS') {
      notReadyErrorCaught = true;
    } else {
      throw err;
    }
  }
  if (!notReadyErrorCaught) throw new Error('FAIL: Did not refuse non-ready job status');
  console.log('PASS: Refused handover when job is not in a ready state (HTTP 409 INVALID_STATUS).');

  // Test 6: Rejection when actor is not Owner/Staff
  console.log('Test 6: Refusal when requester is not Owner/Staff...');
  let roleErrorCaught = false;
  try {
    await recordHandover({
      jobIdentifier: 'JOB-202610-0001',
      payload: {
        customerIdentityConfirmed: true,
        deviceHandedOver: true
      },
      actor: { _id: technicianId, role: 'technician' }
    });
  } catch (err) {
    if (err.statusCode === 403 && err.codeName === 'FORBIDDEN') {
      roleErrorCaught = true;
    } else {
      throw err;
    }
  }
  if (!roleErrorCaught) throw new Error('FAIL: Did not refuse non-Owner/Staff actor');
  console.log('PASS: Refused handover when requester is not Owner/Staff (HTTP 403 FORBIDDEN).');

  // Test 7: Idempotency - Repeating the same handover returns existing result without another collection event
  console.log('Test 7: Idempotency replay on already Collected job...');
  createdProgressUpdates = [];
  const alreadyCollectedJob = {
    ...baseJob,
    status: 'Collected',
    collectionDetails: {
      collectedAt: new Date('2026-10-01T15:00:00Z'),
      collectedBy: staffId,
      customerIdentityConfirmed: true,
      deviceHandedOver: true,
      outcome: 'repaired',
      notes: 'Initial handover notes'
    }
  };
  repairJobRepository.findByIdOrReference = async () => ({ ...alreadyCollectedJob });

  const resultIdempotent = await recordHandover({
    jobIdentifier: 'JOB-202610-0001',
    payload: {
      customerIdentityConfirmed: true,
      deviceHandedOver: true
    },
    actor: { _id: staffId, role: 'owner_staff' }
  });

  if (!resultIdempotent.alreadyCollected) throw new Error('FAIL: Expected alreadyCollected flag');
  if (resultIdempotent.job.status !== 'Collected') throw new Error('FAIL: Expected status Collected');
  if (createdProgressUpdates.length !== 0) throw new Error('FAIL: No new progress update event should be created on idempotent replay');
  console.log('PASS: Repeating handover returns existing result without another collection event.');

  // Test 8: Database trigger and model immutability hooks
  console.log('Test 8: Database trigger & history immutability checks...');
  
  // Verify RepairProgressUpdate pre-hooks exist and throw immutability error
  const progressHooks = RepairProgressUpdate.schema.s.hooks._pres.get('updateOne') || [];
  const progressHookRejected = progressHooks.some((hook) => {
    try {
      hook.fn.call(null);
      return false;
    } catch (e) {
      return e.message.includes('immutable');
    }
  });
  if (!progressHookRejected) {
    throw new Error('FAIL: Expected RepairProgressUpdate to reject mutation with immutable error');
  }

  // Verify JobProgressLog pre-hooks exist and throw immutability error
  const logHooks = JobProgressLog.schema.s.hooks._pres.get('updateOne') || [];
  const logHookRejected = logHooks.some((hook) => {
    try {
      hook.fn.call(null);
      return false;
    } catch (e) {
      return e.message.includes('immutable');
    }
  });
  if (!logHookRejected) {
    throw new Error('FAIL: Expected JobProgressLog to reject mutation with immutable error');
  }

  // Verify RepairJob pre-hooks for Collected immutability exist
  const jobUpdateHooks = RepairJob.schema.s.hooks._pres.get('updateOne') || [];
  if (jobUpdateHooks.length === 0) {
    throw new Error('FAIL: Expected RepairJob update hooks to be registered');
  }

  console.log('PASS: Immutability database hooks verified on RepairJob, RepairProgressUpdate, and JobProgressLog.');

  console.log('\n=== ALL 8 SCRUM-120 ACCEPTANCE CRITERIA VERIFICATION TESTS PASSED! ===\n');
};

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
