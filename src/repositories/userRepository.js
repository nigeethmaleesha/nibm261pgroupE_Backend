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

const findById = (
  id,
  { includePassword = false, includeSessions = false } = {}
) => {
  let query = User.findById(id);

  if (includePassword) {
    query = query.select('+password');
  }

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


const findByRole = (role, { includePassword = false, includeSessions = false } = {}) => {
  let query = User.findOne({ role });

  if (includePassword) query = query.select('+password');
  if (includeSessions) query = query.select('+activeSessions +activeSessions.refreshTokenHash');

  return query;
};

const createPendingInternalUser = (data) => User.create({
  fullName: data.fullName,
  email: data.email,
  contactNumber: data.contactNumber,
  password: data.password,
  role: data.role,
  isEmailVerified: false,
  isActive: true,
  activeSessions: []
});

const listTechnicians = (status = 'active') => {
  const filter = {
    role: 'technician',
    isEmailVerified: true
  };

  if (status === 'active') filter.isActive = true;
  if (status === 'disabled') filter.isActive = false;

  return User.find(filter).sort({ fullName: 1, createdAt: 1 });
};

module.exports = {
  findByEmail,
  findById,
  findByRole,
  createPendingCustomer,
  createPendingInternalUser,
  listTechnicians,
  save
};
