require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const RepairJob = require('../src/models/RepairJob');
const User = require('../src/models/User');
const estimateService = require('../src/services/estimateService');
const estimateRevisionService = require('../src/services/estimateRevisionService');

const identifier = process.argv[2];

const run = async () => {
  try {
    await connectDB();

    let job;
    if (identifier) {
      const filter = mongoose.isValidObjectId(identifier)
        ? { _id: identifier }
        : { reference: String(identifier).trim().toUpperCase() };
      job = await RepairJob.findOne(filter);
    } else {
      job = await RepairJob.findOne();
    }

    if (!job) {
      throw new Error('No repair job found to run SCRUM-85 hold-survives-revision test.');
    }

    // Load Owner/Staff actor
    const ownerStaff = await User.findOne({ role: 'owner_staff' });
    if (!ownerStaff) {
      throw new Error('Owner/Staff user required for issuing revision.');
    }

    // Load Customer actor
    const customer = await User.findById(job.customer);
    if (!customer) {
      throw new Error('Customer user belonging to job required for decision authorization.');
    }

    // Step 1: Ensure initial estimate (v1) exists
    let context = await estimateService.getEstimateContext({
      jobIdentifier: job._id.toString(),
      actor: ownerStaff
    });

    if (!context.currentEstimate) {
      job.status = 'Diagnosing';
      await job.save();

      const diagnoses = mongoose.connection.collection('diagnoses');
      await diagnoses.updateOne(
        { $or: [{ job: job._id }, { jobId: job._id }] },
        {
          $set: {
            job: job._id,
            findings: 'Test diagnosis for SCRUM-85.',
            recommendedWork: 'Replace test component.',
            publicSummary: 'Test repair recommended.',
            completedAt: new Date(),
            isCompleted: true,
            updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      );

      await estimateService.issueInitialEstimate({
        jobIdentifier: job._id.toString(),
        payload: {
          items: [
            { type: 'PART', description: 'Original Part', quantity: 1, unitPrice: '10000.00' }
          ]
        },
        actor: ownerStaff
      });
    }

    // Step 2: Place active parts hold on the job
    console.log('1. Placing active parts hold on repair job...');
    job = await RepairJob.findById(job._id);
    job.status = 'Waiting for Parts';
    job.partsHold = {
      active: true,
      reason: 'Awaiting specialized IC delivery for SCRUM-85 test',
      placedAt: new Date(),
      releasedAt: null
    };
    await job.save();

    console.log(`   Job status: "${job.status}", Parts hold active: ${job.partsHold?.active}`);

    // Step 3: Issue a revised estimate version
    const testPrice = (12000 + Math.floor(Math.random() * 5000)).toFixed(2);
    const revisionResult = await estimateRevisionService.issueRevisedEstimate({
      jobIdentifier: job._id.toString(),
      payload: {
        changeReason: 'SCRUM-85 hold retention test scope update',
        items: [
          { type: 'PART', description: 'Upgraded Part', quantity: 1, unitPrice: testPrice },
          { type: 'LABOUR', description: 'Specialist Labour', quantity: 1, unitPrice: '4000.00' }
        ]
      },
      actor: ownerStaff
    });

    console.log(`   Revision v${revisionResult.estimate.versionNumber} issued (ID: ${revisionResult.estimate.id}).`);

    // Step 4: Approve the revision passing estimateId (SCRUM-84 exact-version check)
    console.log('3. Approving revision (passing required estimateId)...');
    const decisionResult = await estimateService.recordEstimateDecision({
      jobIdentifier: job._id.toString(),
      payload: {
        action: 'APPROVE',
        estimateId: revisionResult.estimate.id,
        versionNumber: revisionResult.estimate.versionNumber,
        total: revisionResult.estimate.total
      },
      actor: customer
    });

    console.log(`   Decision recorded: ${decisionResult.message}`);

    // Step 5: Re-fetch job and assert hold is active and status is 'Approved'
    console.log('4. Re-fetching repair job to verify assertions...');
    const finalJob = await RepairJob.findById(job._id);

    const holdActive = Boolean(finalJob.partsHold?.active);
    const statusApproved = finalJob.status === 'Approved';

    console.log('--------------------------------------------------');
    console.log(`Assert Parts Hold Active (expected: true): ${holdActive}`);
    console.log(`Assert Status (expected: "Approved", got: "${finalJob.status}"): ${statusApproved}`);
    console.log('--------------------------------------------------');

    if (!holdActive) {
      throw new Error('ASSERTION FAILED: Parts hold active flag was cleared unexpectedly!');
    }

    if (finalJob.status !== 'Approved') {
      throw new Error(`ASSERTION FAILED: Job status landed on "${finalJob.status}" instead of "Approved"!`);
    }

    console.log('✅ SCRUM-85 PROOF PASSED: Parts hold survived estimate revision & approval.');
  } catch (error) {
    console.error('❌ SCRUM-85 TEST FAILED:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
