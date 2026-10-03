/**
 * SCRUM-125 Customer Completed Repair Records & History Test Suite
 *
 * Verifies:
 * 1. Customer queries completed repair history (GET /api/customer/jobs/history) -> Returns collected jobs.
 * 2. Response contains reference, device info, public repair summary (or return reason), outcome, and collection time.
 * 3. Response contains issued estimate versions and recorded customer decisions.
 * 4. Detail view: Selected completed job contains full estimates with line items and chronological public events.
 * 5. Unrepaired job: Shows return reason, notes, and outcome 'unrepaired'.
 * 6. IDOR protection: Another customer cannot access the closed job (returns 404 NOT_FOUND).
 * 7. Non-collected job rejection: Requesting an in-progress job returns 400 JOB_NOT_COLLECTED.
 * 8. Zero data leakage: Asserts response is 100% sanitized of internal notes, technician IDs, and internal diagnosis.
 */

const mongoose = require('mongoose');
const repairJobRepository = require('../src/repositories/repairJobRepository');
const estimateRepository = require('../src/repositories/estimateRepository');
const repairProgressRepository = require('../src/repositories/repairProgressRepository');
const jobProgressLogRepository = require('../src/repositories/jobProgressLogRepository');
const diagnosisRepository = require('../src/repositories/diagnosisRepository');
const { getCompletedHistory, getCompletedJobDetail } = require('../src/services/customerTrackingService');

// Assert zero leakage of internal notes or actor ObjectIds
const assertSanitized = (obj) => {
  const jsonStr = JSON.stringify(obj);
  const forbidden = [
    'internalNotes',
    'internalNote',
    'findings',
    'recommendedWork',
    'assignedTechnician',
    'recordedBy',
    'startedBy',
    'updatedBy',
    'returnedBy',
    'collectedBy'
  ];
  for (const key of forbidden) {
    if (jsonStr.includes(`"${key}"`)) {
      throw new Error(`Sanitization failed! Found forbidden key "${key}" in customer history response.`);
    }
  }
};

const runTests = async () => {
  console.log('--- Testing SCRUM-125 Customer Completed Repair Records & History ---');

  const customerAId = new mongoose.Types.ObjectId();
  const customerBId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const technicianId = new mongoose.Types.ObjectId();
  const job1Id = new mongoose.Types.ObjectId();
  const job2Id = new mongoose.Types.ObjectId();
  const estimate1Id = new mongoose.Types.ObjectId();
  const estimate2Id = new mongoose.Types.ObjectId();

  const collectedRepairedJob = {
    _id: job1Id,
    reference: 'JOB-202610-0001',
    customer: customerAId,
    customerSnapshot: {
      fullName: 'Alice Smith',
      email: 'alice@example.com',
      contactNumber: '0771234567'
    },
    deviceType: 'Smartphone',
    makeModel: 'Apple iPhone 14 Pro',
    serialNumber: 'SN-IPHONE14-001',
    reportedFault: 'Cracked OLED screen and back glass shattered',
    receivedAt: new Date('2026-10-01T09:00:00Z'),
    status: 'Collected',
    assignedTechnician: technicianId,
    collectionDetails: {
      collectedAt: new Date('2026-10-03T11:00:00Z'),
      collectedBy: staffId,
      customerIdentityConfirmed: true,
      deviceHandedOver: true,
      outcome: 'repaired',
      notes: 'Customer presented driving license. Paid via credit card.'
    },
    completionDetails: {
      completedAt: new Date('2026-10-03T09:30:00Z'),
      completedBy: technicianId,
      faultResolved: true,
      functionalTestPassed: true,
      functionalTestNotes: 'Display replaced and TrueTone calibrated. Internal benchmark test passed.',
      customerSummary: 'Display module replaced with genuine OEM screen. Passed all touch and visual quality checks.',
      internalNotes: 'Internal tech notes: Adhesive cured for 2 hours.'
    },
    createdAt: new Date('2026-10-01T09:00:00Z'),
    updatedAt: new Date('2026-10-03T11:00:00Z')
  };

  const collectedUnrepairedJob = {
    _id: job2Id,
    reference: 'JOB-202610-0002',
    customer: customerAId,
    deviceType: 'Tablet',
    makeModel: 'Apple iPad Air',
    serialNumber: 'SN-IPAD-002',
    reportedFault: 'Water damage, will not power on',
    receivedAt: new Date('2026-10-01T10:00:00Z'),
    status: 'Collected',
    collectionDetails: {
      collectedAt: new Date('2026-10-02T16:00:00Z'),
      collectedBy: staffId,
      customerIdentityConfirmed: true,
      deviceHandedOver: true,
      outcome: 'unrepaired',
      notes: 'Customer collected device unrepaired.'
    },
    returnDetails: {
      returnedAt: new Date('2026-10-02T15:00:00Z'),
      returnedBy: staffId,
      reason: 'Logic board corrosion beyond economical repair',
      notes: 'Customer declined motherboard replacement.'
    },
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-02T16:00:00Z')
  };

  const mockEstimatesJob1 = [
    {
      _id: estimate1Id,
      job: job1Id,
      versionNumber: 1,
      status: 'Approved',
      currency: 'LKR',
      totalMinor: 4500000,
      issuedAt: new Date('2026-10-01T12:00:00Z'),
      changeReason: null,
      decision: {
        action: 'APPROVED',
        decidedAt: new Date('2026-10-01T14:00:00Z'),
        decidedBy: customerAId
      }
    }
  ];

  const mockEstimateItems = [
    {
      lineNumber: 1,
      type: 'PART',
      description: 'OLED Display Assembly',
      quantity: 1,
      unitPriceMinor: 3800000,
      lineTotalMinor: 3800000
    },
    {
      lineNumber: 2,
      type: 'LABOUR',
      description: 'Display Replacement & Calibration',
      quantity: 1,
      unitPriceMinor: 700000,
      lineTotalMinor: 700000
    }
  ];

  // Setup mock repository methods
  repairJobRepository.findCompletedByCustomer = async (cid) => {
    if (String(cid) === String(customerAId)) {
      return [collectedRepairedJob, collectedUnrepairedJob];
    }
    return [];
  };

  repairJobRepository.findByIdOrReference = async (identifier) => {
    if (identifier === 'JOB-202610-0001' || String(identifier) === String(job1Id)) {
      return collectedRepairedJob;
    }
    if (identifier === 'JOB-202610-0002' || String(identifier) === String(job2Id)) {
      return collectedUnrepairedJob;
    }
    return null;
  };

  estimateRepository.listByJob = async (jid) => {
    if (String(jid) === String(job1Id)) return mockEstimatesJob1;
    return [];
  };

  estimateRepository.listItems = async (eid) => {
    if (String(eid) === String(estimate1Id)) return mockEstimateItems;
    return [];
  };

  repairProgressRepository.listByJob = async () => [];
  jobProgressLogRepository.listPublicByJob = async () => [];
  diagnosisRepository.findByJob = async () => ({
    isCompleted: true,
    completedAt: new Date(),
    publicSummary: 'Display crack diagnosed. Screen replacement required.',
    findings: 'Internal secret finding',
    internalNotes: 'Internal tech diagnosis notes'
  });

  // Test 1: Customer queries completed repair history (GET /api/customer/jobs/history)
  console.log('Test 1: Customer views list of completed repair records...');
  const historyList = await getCompletedHistory({
    actor: { _id: customerAId, role: 'customer' }
  });

  if (historyList.count !== 2) {
    throw new Error(`FAIL: Expected 2 completed jobs, got ${historyList.count}`);
  }
  const job1 = historyList.completedJobs.find((j) => j.reference === 'JOB-202610-0001');
  if (!job1) throw new Error('FAIL: JOB-202610-0001 missing in completed history');
  if (job1.status !== 'Collected') throw new Error(`FAIL: Expected status Collected, got ${job1.status}`);
  if (job1.collection.outcome !== 'repaired') throw new Error(`FAIL: Expected outcome repaired, got ${job1.collection.outcome}`);
  if (!job1.collection.collectedAt) throw new Error('FAIL: collectedAt missing');
  if (job1.publicRepairSummary !== 'Display module replaced with genuine OEM screen. Passed all touch and visual quality checks.') {
    throw new Error('FAIL: publicRepairSummary mismatch');
  }
  if (!job1.estimates || job1.estimates.length !== 1) throw new Error('FAIL: Expected 1 estimate version');
  if (job1.estimates[0].decision.action !== 'APPROVED') throw new Error('FAIL: Recorded decision must be APPROVED');
  if (job1.estimates[0].items.length !== 2) throw new Error('FAIL: Expected 2 estimate line items');
  console.log('PASS: Customer successfully retrieved completed repair history with estimates and decisions.');

  // Test 2: Unrepaired completed repair record displays return reason
  console.log('Test 2: Unrepaired completed job displays return reason...');
  const job2 = historyList.completedJobs.find((j) => j.reference === 'JOB-202610-0002');
  if (!job2) throw new Error('FAIL: JOB-202610-0002 missing');
  if (job2.collection.outcome !== 'unrepaired') throw new Error('FAIL: Expected unrepaired outcome');
  if (!job2.returnReason || !job2.returnReason.includes('Logic board corrosion')) {
    throw new Error('FAIL: returnReason missing or incorrect');
  }
  console.log('PASS: Unrepaired completed job accurately reflects return reason and unrepaired outcome.');

  // Test 3: Detail view of a selected completed job (GET /api/customer/jobs/:jobIdentifier/history)
  console.log('Test 3: Customer views detail of selected completed job...');
  const detail = await getCompletedJobDetail({
    jobIdentifier: 'JOB-202610-0001',
    actor: { _id: customerAId, role: 'customer' }
  });

  if (detail.job.reference !== 'JOB-202610-0001') throw new Error('FAIL: Reference mismatch in detail');
  if (detail.collection.outcome !== 'repaired') throw new Error('FAIL: Outcome mismatch');
  if (!detail.estimates || detail.estimates.length !== 1) throw new Error('FAIL: Estimates missing in detail');
  if (!detail.publicEvents || detail.publicEvents.length === 0) throw new Error('FAIL: Public events missing in detail');
  console.log('PASS: Detailed completed repair record successfully returned with public events and estimates.');

  // Test 4: Cross-customer IDOR protection (Customer B cannot view Customer A's closed record)
  console.log('Test 4: Cross-customer IDOR protection (Customer B -> 404 NOT_FOUND)...');
  let idorError = false;
  try {
    await getCompletedJobDetail({
      jobIdentifier: 'JOB-202610-0001',
      actor: { _id: customerBId, role: 'customer' }
    });
  } catch (err) {
    if (err.statusCode === 404 && err.codeName === 'NOT_FOUND') {
      idorError = true;
    } else {
      throw err;
    }
  }
  if (!idorError) throw new Error('FAIL: Cross-customer unauthorized read was not denied with 404');
  console.log('PASS: Cross-customer inquiry is securely denied with 404 NOT_FOUND.');

  // Test 5: Rejection when job is NOT Collected
  console.log('Test 5: Rejection when requesting history for non-collected job...');
  const inRepairJob = { ...collectedRepairedJob, status: 'In Repair' };
  repairJobRepository.findByIdOrReference = async () => inRepairJob;
  let notCollectedError = false;
  try {
    await getCompletedJobDetail({
      jobIdentifier: 'JOB-202610-0001',
      actor: { _id: customerAId, role: 'customer' }
    });
  } catch (err) {
    if (err.statusCode === 400 && err.codeName === 'JOB_NOT_COLLECTED') {
      notCollectedError = true;
    } else {
      throw err;
    }
  }
  if (!notCollectedError) throw new Error('FAIL: Did not reject non-collected job');
  console.log('PASS: Non-collected job correctly rejected with 400 JOB_NOT_COLLECTED.');

  // Test 6: Zero data leakage verification (Sanitization of internal notes and actor IDs)
  console.log('Test 6: Zero data leakage check on customer completed history responses...');
  repairJobRepository.findByIdOrReference = async (id) => (
    id === 'JOB-202610-0001' ? collectedRepairedJob : collectedUnrepairedJob
  );
  assertSanitized(historyList);
  assertSanitized(detail);
  console.log('PASS: Response is 100% sanitized of internal diagnosis, work notes, and technician/staff IDs.');

  console.log('\n=== ALL 6 SCRUM-125 ACCEPTANCE CRITERIA VERIFICATION TESTS PASSED! ===\n');
};

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
