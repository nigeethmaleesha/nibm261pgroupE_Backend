const User = require('../models/User');

const findByEmail = (email, { includePassword = false, includeSessions = false } = {}) => {
  let query = User.findOne({ email });

  if (includePassword) {
    query = query.select('+password');
  }

  if (includeSessions) {
    query = query.select('+activeSessions +activeSessions.refreshTokenHash');
  }

  return query;
};

const findById = (id, { includeSessions = false } = {}) => {
  let query = User.findById(id);

  if (includeSessions) {
    query = query.select('+activeSessions +activeSessions.refreshTokenHash');
  }

  return query;
};

const createPendingCustomer = (data) => User.create({
  fullName: data.fullName,
  email: data.email,
  contactNumber: data.contactNumber,
  password: data.password,
  role: 'customer',
  isEmailVerified: false,
  isActive: true,
  activeSessions: []
});

const save = (user) => user.save();

module.exports = {
  findByEmail,
  findById,
  createPendingCustomer,
  save
};
