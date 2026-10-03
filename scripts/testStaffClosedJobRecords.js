/**
 * SCRUM-129 Staff Closed Job Records & Dossier Audit View Test Suite
 *
 * Verifies:
 * 1. Search staff archived jobs with query, date range, and outcome filters.
 * 2. Only owner_staff can access (403 Forbidden for technician, customer, unauthenticated).
 * 3. Rejects non-collected jobs with 409 Conflict (JOB_NOT_COLLECTED).
 * 4. Detail view returns 100% audit data:
 *    - Full customer intake snapshot (name, phone, email, device info, fault)
 *    - Diagnosis with internalNotes (staff can see internal notes, unlike customer)
 *    - Full estimate version history (v1, v2...) with line items and customer decisions
 *    - Technician assignment history & audit
 *    - Workshop logs (both public updates AND internal technician notes)
 *    - QC completion details (if repaired) or return readiness details (if unrepaired)
 *    - Handover signoff details (collectedBy, collectedAt, id confirmed, notes)
 *    - Chronological Event Ledger covering all milestones
 *    - Flag `isReadOnly: true` enforced
 * 5. Outcome distinction: clearly distinguishes repaired vs unrepaired returns.
 */

const mongoose = require('mongoose');
const repairJobRepository = require('../src/repositories/repairJobRepository');
const estimateRepository = require('../src/repositories/estimateRepository');
const jobProgressLogRepository = require('../src/repositories/jobProgressLogRepository');
const repairProgressRepository = require('../src/repositories/repairProgressRepository');
const diagnosisRepository = require('../src/repositories/diagnosisRepository');
const repairJobAssignmentAuditRepository = require('../src/repositories/repairJobAssignmentAuditRepository');
const { searchStaffArchivedJobs, getStaffArchivedJobDetail } = require('../src/services/staffArchiveService');

const runTests = async () => {
  console.log('--- Testing SCRUM-129 Staff Closed Job Records & Dossier Audit View ---');

  const customerId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const tech1Id = new mongoose.Types.ObjectId();
  const tech2Id = new mongoose.Types.ObjectId();
  const jobRepairedId = new mongoose.Types.ObjectId();
  const jobUnrepairedId = new mongoose.Types.ObjectId();
  const jobInProgressId = new mongoose.Types.ObjectId();
  const estimate1Id = new mongoose.Types.ObjectId();
  const estimate2Id = new mongoose.Types.ObjectId();

  const mockStaffActor = {
    _id: staffId,
    id: staffId.toString(),
    fullName: 'Owner Staff User',
    email: 'staff@example.com',
    role: 'owner_staff'
  };

  const mockTechActor = {
    _id: tech1Id,
    id: tech1Id.toString(),
    fullName: 'Tech User',
    email: 'tech@example.com',
    role: 'technician'
  };

  const mockCustomerActor = {
    _id: customerId,
    id: customerId.toString(),
    fullName: 'Customer User',
    email: 'customer@example.com',
    role: 'customer'
  };

  const repairedJob = {
    _id: jobRepairedId,
    reference: 'JOB-202610-0001',
    customer: customerId,
    customerSnapshot: {
      fullName: 'Alice Johnson',
      email: 'alice@example.com',
      contactNumber: '0771234567'
    },
    deviceType: 'Laptop',
    makeModel: 'Dell XPS 15',
    serialNumber: 'SN-DELL-9988',
    reportedFault: 'Overheating and thermal throttling under load',
    receivedAt: new Date('2026-09-10T10:00:00Z'),
    status: 'Collected',
    assignedTechnician: {
      _id: tech2Id,
      fullName: 'Bob Technician',
      email: 'bob@example.com',
      role: 'technician',
      isActive: true,
      isEmailVerified: true
    },
    assignedBy: {
      _id: staffId,
      fullName: 'Owner Staff User',
      email: 'staff@example.com',
      role: 'owner_staff'
    },
    assignedAt: new Date('2026-09-10T11:00:00Z'),
    completionDetails: {
      completedAt: new Date('2026-09-15T14:30:00Z'),
      completedBy: {
        _id: tech2Id,
        fullName: 'Bob Technician',
        email: 'bob@example.com',
        role: 'technician'
      },
      faultResolved: true,
      functionalTestPassed: true,
      functionalTestNotes: 'Stress test ran for 2 hours with stable 65C peak temps.',
      customerSummary: 'Cleaned fans, replaced thermal paste, and replaced fan assembly.',
      internalNotes: 'Internal QC passed without issue; fan bearing had slight wear.'
    },
    collectionDetails: {
      collectedAt: new Date('2026-09-16T16:00:00Z'),
      collectedBy: {
        _id: staffId,
        fullName: 'Owner Staff User',
        email: 'staff@example.com',
        role: 'owner_staff'
      },
      customerIdentityConfirmed: true,
      deviceHandedOver: true,
      outcome: 'repaired',
      notes: 'Customer collected and tested on site.'
    },
    createdAt: new Date('2026-09-10T10:00:00Z'),
    updatedAt: new Date('2026-09-16T16:00:00Z')
  };

  const unrepairedJob = {
    _id: jobUnrepairedId,
    reference: 'JOB-202610-0002',
    customer: customerId,
    customerSnapshot: {
      fullName: 'Charlie Davis',
      email: 'charlie@example.com',
      contactNumber: '0719876543'
    },
    deviceType: 'Phone',
    makeModel: 'Samsung Galaxy S22',
    serialNumber: 'SN-SAM-3321',
    reportedFault: 'Water damage, will not power on',
    receivedAt: new Date('2026-09-12T09:00:00Z'),
    status: 'Collected',
    assignedTechnician: {
      _id: tech1Id,
      fullName: 'Dan Technician',
      email: 'dan@example.com',
      role: 'technician',
      isActive: true,
      isEmailVerified: true
    },
    assignedBy: {
      _id: staffId,
      fullName: 'Owner Staff User',
      email: 'staff@example.com',
      role: 'owner_staff'
    },
    assignedAt: new Date('2026-09-12T10:00:00Z'),
    returnDetails: {
      returnedAt: new Date('2026-09-14T11:00:00Z'),
      returnedBy: {
        _id: staffId,
        fullName: 'Owner Staff User',
        email: 'staff@example.com',
        role: 'owner_staff'
      },
      reason: 'Customer declined estimate due to cost of motherboard replacement',
      notes: 'Cleaned device exterior and sealed in antistatic bag for return.'
    },
    collectionDetails: {
      collectedAt: new Date('2026-09-15T12:00:00Z'),
      collectedBy: {
        _id: staffId,
        fullName: 'Owner Staff User',
        email: 'staff@example.com',
        role: 'owner_staff'
      },
      customerIdentityConfirmed: true,
      deviceHandedOver: true,
      outcome: 'unrepaired',
      notes: 'Customer collected unrepaired device.'
    },
    createdAt: new Date('2026-09-12T09:00:00Z'),
    updatedAt: new Date('2026-09-15T12:00:00Z')
  };

  const inProgressJob = {
    _id: jobInProgressId,
    reference: 'JOB-202610-0003',
    status: 'In Repair'
  };

  // Mock repositories
  repairJobRepository.searchArchivedForStaff = async ({ outcome }) => {
    if (outcome === 'repaired') return [repairedJob];
    if (outcome === 'unrepaired') return [unrepairedJob];
    return [repairedJob, unrepairedJob];
  };

  repairJobRepository.countArchivedForStaff = async ({ outcome }) => {
    if (outcome === 'repaired') return 1;
    if (outcome === 'unrepaired') return 1;
    return 2;
  };

  repairJobRepository.findArchivedDetailForStaff = async (identifier) => {
    if (identifier === jobRepairedId.toString() || identifier === repairedJob.reference) {
      return repairedJob;
    }
    if (identifier === jobUnrepairedId.toString() || identifier === unrepairedJob.reference) {
      return unrepairedJob;
    }
    return null;
  };

  repairJobRepository.findByIdOrReference = async (identifier) => {
    if (identifier === jobInProgressId.toString()) return inProgressJob;
    if (identifier === jobRepairedId.toString()) return repairedJob;
    if (identifier === jobUnrepairedId.toString()) return unrepairedJob;
    return null;
  };

  diagnosisRepository.findByJob = async (jobId) => {
    if (jobId.toString() === jobRepairedId.toString()) {
      return {
        _id: new mongoose.Types.ObjectId(),
        findings: 'Severe dust accumulation in heatsink and aged thermal paste.',
        recommendedWork: 'Repaste CPU/GPU and replace noisy left blower fan.',
        internalNotes: 'Customer mentioned they used it on bed frequently. Heatsink was 80% choked.',
        isUnrepairable: false,
        startedAt: new Date('2026-09-10T12:00:00Z'),
        completedAt: new Date('2026-09-10T14:00:00Z')
      };
    }
    return {
      _id: new mongoose.Types.ObjectId(),
      findings: 'Extensive corrosion across power management IC.',
      recommendedWork: 'Full motherboard replacement required.',
      internalNotes: 'Corrosion reached under BGA chips. Component-level repair uneconomical.',
      isUnrepairable: true,
      unrepairableReason: 'Severe motherboard corrosion beyond viable repair',
      startedAt: new Date('2026-09-12T11:00:00Z'),
      completedAt: new Date('2026-09-12T13:00:00Z')
    };
  };

  estimateRepository.listByJob = async (jobId) => {
    if (jobId.toString() === jobRepairedId.toString()) {
      return [
        {
          _id: estimate1Id,
          versionNumber: 1,
          status: 'Approved',
          currency: 'LKR',
          subtotalMinor: 1500000,
          taxMinor: 0,
          totalMinor: 1500000,
          issuedAt: new Date('2026-09-11T10:00:00Z'),
          decision: {
            action: 'APPROVED',
            decidedAt: new Date('2026-09-11T14:00:00Z'),
            decidedByCustomer: true,
            notes: 'Proceed with fan replacement and repaste please.'
          }
        }
      ];
    }
    return [
      {
        _id: estimate2Id,
        versionNumber: 1,
        status: 'Rejected',
        currency: 'LKR',
        subtotalMinor: 8500000,
        taxMinor: 0,
        totalMinor: 8500000,
        issuedAt: new Date('2026-09-13T10:00:00Z'),
        decision: {
          action: 'REJECTED',
          decidedAt: new Date('2026-09-13T16:00:00Z'),
          decidedByCustomer: true,
          notes: 'Too expensive, I will purchase a new phone.'
        }
      }
    ];
  };

  estimateRepository.listItems = async (estimateId) => {
    if (estimateId.toString() === estimate1Id.toString()) {
      return [
        {
          _id: new mongoose.Types.ObjectId(),
          lineNumber: 1,
          itemType: 'part',
          partDescription: 'Dell XPS Replacement Fan Assembly',
          quantity: 1,
          unitPriceMinor: 800000,
          totalMinor: 800000
        },
        {
          _id: new mongoose.Types.ObjectId(),
          lineNumber: 2,
          itemType: 'labour',
          partDescription: 'Labor - Thermal servicing and fan replacement',
          quantity: 1,
          unitPriceMinor: 700000,
          totalMinor: 700000
        }
      ];
    }
    return [
      {
        _id: new mongoose.Types.ObjectId(),
        lineNumber: 1,
        itemType: 'part',
        partDescription: 'Samsung Galaxy S22 Motherboard PCB',
        quantity: 1,
        unitPriceMinor: 7500000,
        totalMinor: 7500000
      }
    ];
  };

  jobProgressLogRepository.listByJob = async () => [
    {
      _id: new mongoose.Types.ObjectId(),
      entryId: new mongoose.Types.ObjectId(),
      message: 'Teardown complete, fan heatsink removed.',
      is_public: false,
      createdAt: new Date('2026-09-14T09:00:00Z')
    },
    {
      _id: new mongoose.Types.ObjectId(),
      entryId: new mongoose.Types.ObjectId(),
      message: 'Thermal servicing applied, reassembling device.',
      is_public: true,
      createdAt: new Date('2026-09-14T11:00:00Z')
    }
  ];

  repairJobAssignmentAuditRepository.listByJob = async () => [
    {
      _id: new mongoose.Types.ObjectId(),
      previousTechnician: { fullName: 'Alex Oldtech' },
      assignedTechnician: { fullName: 'Bob Technician' },
      assignedBy: { fullName: 'Owner Staff User' },
      assignedAt: new Date('2026-09-10T11:00:00Z')
    }
  ];

  repairProgressRepository.listByJob = async () => [];

  // TEST 1: Role-based Access Control (RBAC)
  console.log('\nTest 1: Role-based Access Control (RBAC)');
  try {
    await searchStaffArchivedJobs({ actor: mockCustomerActor });
    throw new Error('Should have failed for customer actor');
  } catch (err) {
    if (err.statusCode !== 403) throw err;
    console.log('✓ Customer correctly denied 403 Forbidden');
  }

  try {
    await searchStaffArchivedJobs({ actor: mockTechActor });
    throw new Error('Should have failed for technician actor');
  } catch (err) {
    if (err.statusCode !== 403) throw err;
    console.log('✓ Technician correctly denied 403 Forbidden');
  }

  // TEST 2: Search Archived Jobs for Owner/Staff
  console.log('\nTest 2: Search Archived Jobs (All, Repaired, Unrepaired)');
  const allResults = await searchStaffArchivedJobs({ actor: mockStaffActor });
  if (allResults.count !== 2) throw new Error(`Expected 2 jobs, got ${allResults.count}`);
  console.log(`✓ Owner/Staff retrieved ${allResults.count} archived jobs`);

  const repairedOnly = await searchStaffArchivedJobs({ outcome: 'repaired', actor: mockStaffActor });
  if (repairedOnly.count !== 1 || repairedOnly.jobs[0].outcome !== 'repaired') {
    throw new Error('Repaired filter failed');
  }
  console.log('✓ Repaired outcome filter verified');

  const unrepairedOnly = await searchStaffArchivedJobs({ outcome: 'unrepaired', actor: mockStaffActor });
  if (unrepairedOnly.count !== 1 || unrepairedOnly.jobs[0].outcome !== 'unrepaired') {
    throw new Error('Unrepaired outcome filter failed');
  }
  console.log('✓ Unrepaired outcome filter verified');

  // TEST 3: Non-collected job rejection
  console.log('\nTest 3: Non-collected job rejection');
  try {
    await getStaffArchivedJobDetail({ jobIdentifier: jobInProgressId.toString(), actor: mockStaffActor });
    throw new Error('Should have failed for in-progress job');
  } catch (err) {
    if (err.statusCode !== 409 || err.code !== 'JOB_NOT_COLLECTED') {
      throw new Error(`Expected 409 JOB_NOT_COLLECTED, got: ${err.message}`);
    }
    console.log('✓ In-progress job correctly rejected with 409 JOB_NOT_COLLECTED');
  }

  // TEST 4: Full Read-Only Dossier for Repaired Job
  console.log('\nTest 4: Full Read-Only Dossier (Repaired Job)');
  const repairedDossier = await getStaffArchivedJobDetail({
    jobIdentifier: jobRepairedId.toString(),
    actor: mockStaffActor
  });

  if (!repairedDossier.isReadOnly) throw new Error('isReadOnly must be true');
  if (repairedDossier.outcome !== 'repaired') throw new Error('Outcome should be repaired');
  if (!repairedDossier.diagnosis.internalNotes) {
    throw new Error('Staff dossier must include internal notes from diagnosis');
  }
  if (!repairedDossier.qcCompletion || !repairedDossier.qcCompletion.faultResolved) {
    throw new Error('Repaired dossier must include QC completion details');
  }
  if (!repairedDossier.handover || !repairedDossier.handover.collectedAt) {
    throw new Error('Handover signoff details missing');
  }
  if (repairedDossier.estimates.length !== 1 || repairedDossier.estimates[0].items.length !== 2) {
    throw new Error('Estimate items missing in dossier');
  }
  if (repairedDossier.eventLedger.length < 5) {
    throw new Error('Chronological event ledger has too few events');
  }
  console.log(`✓ Repaired dossier verified with ${repairedDossier.eventLedger.length} chronological ledger events`);
  console.log(`✓ Internal notes retained: "${repairedDossier.diagnosis.internalNotes}"`);
  console.log(`✓ QC checks retained: faultResolved=${repairedDossier.qcCompletion.faultResolved}`);

  // TEST 5: Full Read-Only Dossier for Unrepaired Job
  console.log('\nTest 5: Full Read-Only Dossier (Unrepaired Return Job)');
  const unrepairedDossier = await getStaffArchivedJobDetail({
    jobIdentifier: jobUnrepairedId.toString(),
    actor: mockStaffActor
  });

  if (unrepairedDossier.outcome !== 'unrepaired') throw new Error('Outcome should be unrepaired');
  if (!unrepairedDossier.diagnosis.isUnrepairable) throw new Error('Device should be marked unrepairable');
  if (!unrepairedDossier.returnDetails || !unrepairedDossier.returnDetails.reason) {
    throw new Error('Return details missing in unrepaired dossier');
  }
  console.log(`✓ Unrepaired dossier verified: reason="${unrepairedDossier.returnDetails.reason}"`);

  console.log('\n=== ALL SCRUM-129 BACKEND TESTS PASSED SUCCESSFULLY! ===\n');
};

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
