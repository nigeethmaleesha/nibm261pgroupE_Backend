const mongoose = require('mongoose');

const connectDB = async () => {
  const options = {};

  if (process.env.MONGO_DB_NAME) {
    options.dbName = process.env.MONGO_DB_NAME;
  }

  const connection = await mongoose.connect(process.env.MONGO_URI, options);
  console.log(`MongoDB connected: ${connection.connection.host}/${connection.connection.name}`);
  return connection;
};

module.exports = connectDB;
