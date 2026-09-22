require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Otp = require('../src/models/Otp');
const RepairJob = require('../src/models/RepairJob');

const syncIndexes = async () => {
  try {
    await connectDB();

    const userResult = await User.syncIndexes();
    const otpResult = await Otp.syncIndexes();
    const repairJobResult = await RepairJob.syncIndexes();

    console.log('User indexes synchronized. Removed indexes:', userResult);
    console.log('User indexes:', await User.collection.indexes());
    console.log('OTP indexes synchronized. Removed indexes:', otpResult);
    console.log('OTP indexes:', await Otp.collection.indexes());
    console.log('RepairJob indexes synchronized. Removed indexes:', repairJobResult);
    console.log('RepairJob indexes:', await RepairJob.collection.indexes());
  } catch (error) {
    console.error('Index synchronization failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

syncIndexes();
