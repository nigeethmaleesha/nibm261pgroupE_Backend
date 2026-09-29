const dns = require('dns');
const mongoose = require('mongoose');

// Some local/ISP DNS resolvers refuse the SRV lookup needed by mongodb+srv://
// URIs (querySrv ECONNREFUSED). Use public resolvers for every entry point that
// connects: the API server and the scripts in /scripts.
dns.setServers(['8.8.8.8', '1.1.1.1']);

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
