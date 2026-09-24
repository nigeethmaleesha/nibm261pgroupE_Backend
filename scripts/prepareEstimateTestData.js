require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const RepairJob = require('../src/models/RepairJob');
const User = require('../src/models/User');

const identifier = process.argv[2];

if (!identifier) {
  console.error('Usage: node scripts/prepareEstimateTestData.js <repairJobId-or-reference>');
  process.exit(1);
}

const run = async () => {
  try {
    await connectDB();

    const filter = mongoose.isValidObjectId(identifier)
      ? { _id: identifier }
      : { reference: String(identifier).trim().toUpperCase() };

    const job = await RepairJob.findOne(filter);
    if (!job) throw new Error('Repair job not found');
    if (job.currentEstimate) throw new Error('This job already has a current estimate');

    const technician = await User.findOne({
      role: 'technician',
      isActive: true,
      isEmailVerified: true
    });
    if (!technician) {
      throw new Error('Create and verify at least one Technician before preparing estimate test data');
    }

    job.status = 'Diagnosing';
    await job.save();

    const diagnoses = mongoose.connection.collection('diagnoses');
    await diagnoses.updateOne(
      { $or: [{ job: job._id }, { jobId: job._id }] },
      {
        $set: {
          job: job._id,
          technicianId: technician._id,
          findings: 'Synthetic test diagnosis: charging connector contact damage identified.',
          recommendedWork: 'Replace the charging connector and complete charging/data tests.',
          publicSummary: 'A charging connector repair is recommended.',
          isUnrepairable: false,
          completedAt: new Date(),
          isCompleted: true,
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    console.log('Estimate test prerequisite prepared.');
    console.log('Job ID:', job._id.toString());
    console.log('Reference:', job.reference);
    console.log('Status:', job.status);
    console.log('Technician:', technician.email);
  } catch (error) {
    console.error('Could not prepare estimate test data:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
