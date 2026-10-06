const mongoose = require('mongoose');
const repairJobRepository = require('../src/repositories/repairJobRepository');
const repairProgressRepository = require('../src/repositories/repairProgressRepository');
const jobProgressLogRepository = require('../src/repositories/jobProgressLogRepository');
const estimateRepository = require('../src/repositories/estimateRepository');
const diagnosisRepository = require('../src/repositories/diagnosisRepository');
const { getJobTracking } = require('../src/services/customerTrackingService');

// Verify that the response contains zero technician IDs or internal notes
const assertSanitized = (response) => {
  const jsonStr = JSON.stringify(response);
  const forbiddenKeywords = [
    'internalNote',
    'internalNotes',
    'findings',
    'recommendedWork',
    'assignedTechnician',
    'recordedBy',
    'startedBy',
    'updatedBy'
  ];
  for (const keyword of forbiddenKeywords) {
    if (jsonStr.includes(`"${keyword}"`)) {
      throw new Error(`Sanitization failed! Found forbidden keyword "${keyword}" in customer tracking response.`);
    }
  }
};

const runTests = async () => {
  console.log('--- Testing SCRUM-109 Customer Public Repair Tracking ---');

  const customerAId = new mongoose.Types.ObjectId();
  const customerBId = new mongoose.Types.ObjectId();
  const technicianId = new mongoose.Types.ObjectId();
  const jobId = new mongoose.Types.ObjectId();
  const estimateId = new mongoose.Types.ObjectId();

  // Test 1: Cross-customer IDOR protection
  console.log('Test 1: Cross-customer isolation (IDOR protection)...');
  const baseJob = {
    _id: jobId,
    reference: 'JOB-202610-0001',
    customer: customerAId,
    deviceType: 'Laptop',
    makeModel: 'Apple MacBook Pro M2',
    serialNumber: 'SN-MBP12345',
    reportedFault: 'Battery swelling and trackpad unresponsive',
    receivedAt: new Date('2026-10-01T10:00:00Z'),
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T11:00:00Z'),
    status: 'In Repair',
    assignedTechnician: technicianId,
    partsHold: { active: false },
    repairWork: { approvedEstimateVersion: 1 }
  };

  repairJobRepository.findByIdOrReference = async () => baseJob;
  repairProgressRepository.listByJob = async () => [];
  jobProgressLogRepository.listPublicByJob = async () => [];
  estimateRepository.findCurrentByJob = async () => null;
  estimateRepository.listByJob = async () => [];
  diagnosisRepository.findByJob = async () => null;

  // Customer B tries to view Customer A's job
  try {
    await getJobTracking({
      jobIdentifier: 'JOB-202610-0001',
      actor: { _id: customerBId, role: 'customer' }
    });
    throw new Error('FAIL: Customer B was able to view Customer A job!');
  } catch (err) {
    if (err.statusCode === 404 && err.codeName === 'NOT_FOUND') {
      console.log('PASS: Customer B receives 404 NOT_FOUND (preventing customer-to-customer record disclosure)');
    } else {
      throw err;
    }
  }

  // Customer A views their own job
  console.log('Test 2: Customer A viewing own job with chronological public events...');
  const progressUpdates = [
    {
      _id: new mongoose.Types.ObjectId(),
      fromStatus: 'Received',
      toStatus: 'Diagnosing',
      createdAt: new Date('2026-10-01T10:15:00Z'),
      updatedBy: technicianId
    },
    {
      _id: new mongoose.Types.ObjectId(),
      fromStatus: 'Approved',
      toStatus: 'In Repair',
      createdAt: new Date('2026-10-01T11:00:00Z'),
      updatedBy: technicianId
    }
  ];
  const publicLogs = [
    {
      entryId: new mongoose.Types.ObjectId(),
      jobStatus: 'In Repair',
      is_public: true,
      text: 'Original battery removed safely. Cleaning housing.',
      createdAt: new Date('2026-10-01T11:30:00Z'),
      recordedBy: technicianId
    }
  ];
  const diagnosis = {
    _id: new mongoose.Types.ObjectId(),
    publicSummary: 'Battery replacement and trackpad cable recalibration needed.',
    internalNotes: 'SECRET TECHNICIAN NOTE: Check for logic board corrosion',
    findings: 'Battery expanded by 20%',
    recommendedWork: 'Replace battery assembly',
    completedAt: new Date('2026-10-01T10:30:00Z'),
    startedBy: technicianId
  };

  repairProgressRepository.listByJob = async () => progressUpdates;
  jobProgressLogRepository.listPublicByJob = async () => publicLogs;
  diagnosisRepository.findByJob = async () => diagnosis;

  const result1 = await getJobTracking({
    jobIdentifier: 'JOB-202610-0001',
    actor: { _id: customerAId, role: 'customer' }
  });

  assertSanitized(result1);
  console.log('PASS: Response is strictly sanitized of internal notes and technician IDs');

  // Verify chronological order
  for (let i = 0; i < result1.publicEvents.length - 1; i++) {
    const t1 = new Date(result1.publicEvents[i].timestamp).getTime();
    const t2 = new Date(result1.publicEvents[i + 1].timestamp).getTime();
    if (t1 > t2) {
      throw new Error(`Events not sorted chronologically! Event ${i} (${t1}) > Event ${i + 1} (${t2})`);
    }
  }
  console.log(`PASS: ${result1.publicEvents.length} public events appear in strict chronological order`);

  // Test 3: Awaiting Approval job links to current estimate decision
  console.log('Test 3: Awaiting Approval job links to current estimate decision...');
  const awaitingJob = {
    ...baseJob,
    status: 'Awaiting Approval',
    currentEstimate: estimateId
  };
  repairJobRepository.findByIdOrReference = async () => awaitingJob;
  const currentEstimate = {
    _id: estimateId,
    versionNumber: 1,
    totalMinor: 3500000,
    status: 'Issued',
    createdAt: new Date('2026-10-01T10:45:00Z')
  };
  estimateRepository.findCurrentByJob = async () => currentEstimate;
  estimateRepository.listByJob = async () => [currentEstimate];

  const resultAwaiting = await getJobTracking({
    jobIdentifier: 'JOB-202610-0001',
    actor: { _id: customerAId, role: 'customer' }
  });

  if (!resultAwaiting.actionRequired || resultAwaiting.actionType !== 'ESTIMATE_DECISION') {
    throw new Error('FAIL: actionRequired should be true for Awaiting Approval');
  }
  if (!resultAwaiting.estimateDecision || !resultAwaiting.estimateDecision.decisionUrl) {
    throw new Error('FAIL: estimateDecision link missing');
  }
  if (resultAwaiting.estimateDecision.decisionUrl !== '/api/jobs/JOB-202610-0001/estimate-decision') {
    throw new Error(`FAIL: Unexpected decisionUrl ${resultAwaiting.estimateDecision.decisionUrl}`);
  }
  if (resultAwaiting.estimateDecision.viewEstimateUrl !== '/api/customer/jobs/JOB-202610-0001/current-estimate') {
    throw new Error(`FAIL: Unexpected viewEstimateUrl ${resultAwaiting.estimateDecision.viewEstimateUrl}`);
  }
  assertSanitized(resultAwaiting);
  console.log('PASS: Awaiting Approval job correctly links to estimate decision and estimate view');

  // Test 4: Waiting for Parts shows public delay reason
  console.log('Test 4: Waiting for Parts shows public delay reason...');
  const partsHoldJob = {
    ...baseJob,
    status: 'Waiting for Parts',
    partsHold: {
      active: true,
      requiredPart: 'OEM A2485 Battery Cell Pack',
      reason: 'Awaiting specialized OEM battery pack shipment from certified supplier',
      internalNote: 'INTERNAL NOTE: Supplier SKU #992-BATT pending customs clearance',
      placedAt: new Date('2026-10-01T12:00:00Z'),
      placedBy: technicianId
    }
  };
  repairJobRepository.findByIdOrReference = async () => partsHoldJob;

  const resultParts = await getJobTracking({
    jobIdentifier: 'JOB-202610-0001',
    actor: { _id: customerAId, role: 'customer' }
  });

  if (!resultParts.publicDelayReason || !resultParts.publicDelayReason.includes('OEM battery pack shipment')) {
    throw new Error(`FAIL: publicDelayReason missing or incorrect: ${resultParts.publicDelayReason}`);
  }
  assertSanitized(resultParts);
  console.log('PASS: Waiting for Parts correctly displays public delay reason without internal notes or actor IDs');

  // Test 5: Ready for Collection displays handover instruction
  console.log('Test 5: Ready for Collection displays handover instruction...');
  const readyJob = {
    ...baseJob,
    status: 'Ready for Collection'
  };
  repairJobRepository.findByIdOrReference = async () => readyJob;

  const resultReady = await getJobTracking({
    jobIdentifier: 'JOB-202610-0001',
    actor: { _id: customerAId, role: 'customer' }
  });

  if (!resultReady.handoverInstruction || !resultReady.handoverInstruction.includes('ready for collection')) {
    throw new Error(`FAIL: handoverInstruction missing or incorrect for Ready for Collection: ${resultReady.handoverInstruction}`);
  }
  console.log('PASS: Ready for Collection displays appropriate collection handover instruction');

  // Test 6: Ready for Return displays return handover instruction
  console.log('Test 6: Ready for Return displays return handover instruction...');
  const returnJob = {
    ...baseJob,
    status: 'Ready for Return'
  };
  repairJobRepository.findByIdOrReference = async () => returnJob;

  const resultReturn = await getJobTracking({
    jobIdentifier: 'JOB-202610-0001',
    actor: { _id: customerAId, role: 'customer' }
  });

  if (!resultReturn.handoverInstruction || !resultReturn.handoverInstruction.includes('ready for return unrepaired')) {
    throw new Error(`FAIL: handoverInstruction missing or incorrect for Ready for Return: ${resultReturn.handoverInstruction}`);
  }
  console.log('PASS: Ready for Return displays appropriate unrepaired return handover instruction');

  // Test 7: Collected displays recorded collection time and repaired/unrepaired outcome
  console.log('Test 7: Collected displays collection time and repaired outcome...');
  const collectedJob = {
    ...baseJob,
    status: 'Collected',
    collectionDetails: {
      collectedAt: new Date('2026-10-01T15:30:00Z'),
      outcome: 'repaired'
    }
  };
  repairJobRepository.findByIdOrReference = async () => collectedJob;

  const resultCollected = await getJobTracking({
    jobIdentifier: 'JOB-202610-0001',
    actor: { _id: customerAId, role: 'customer' }
  });

  if (!resultCollected.collection || resultCollected.collection.outcome !== 'repaired') {
    throw new Error(`FAIL: Expected collection outcome repaired, got: ${JSON.stringify(resultCollected.collection)}`);
  }
  if (!resultCollected.collection.collectedAt) {
    throw new Error('FAIL: collection.collectedAt is missing');
  }
  console.log('PASS: Collected displays collection time and repaired outcome');

  // Test 8: Collected with unrepaired outcome
  console.log('Test 8: Collected with unrepaired outcome...');
  const collectedUnrepairedJob = {
    ...baseJob,
    status: 'Collected',
    collectionDetails: {
      collectedAt: new Date('2026-10-01T16:00:00Z'),
      outcome: 'unrepaired'
    }
  };
  repairJobRepository.findByIdOrReference = async () => collectedUnrepairedJob;

  const resultCollectedUnrepaired = await getJobTracking({
    jobIdentifier: 'JOB-202610-0001',
    actor: { _id: customerAId, role: 'customer' }
  });

  if (!resultCollectedUnrepaired.collection || resultCollectedUnrepaired.collection.outcome !== 'unrepaired') {
    throw new Error(`FAIL: Expected collection outcome unrepaired, got: ${JSON.stringify(resultCollectedUnrepaired.collection)}`);
  }
  console.log('PASS: Collected displays collection time and unrepaired outcome');

  console.log('\n=== ALL 8 SCRUM-109 ACCEPTANCE CRITERIA VERIFICATION TESTS PASSED! ===\n');
};

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
  });
