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


const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findRegisteredCustomerById = (id) => User.findOne({
  _id: id,
  role: 'customer',
  isActive: true,
  isEmailVerified: true
});

const searchRegisteredCustomers = (query, limit = 10) => {
  const safeQuery = escapeRegExp(query);
  const matcher = { $regex: safeQuery, $options: 'i' };

  return User.find({
    role: 'customer',
    isActive: true,
    isEmailVerified: true,
    $or: [
      { fullName: matcher },
      { email: matcher },
      { contactNumber: matcher }
    ]
  })
    .select('_id fullName email contactNumber')
    .sort({ fullName: 1, _id: 1 })
    .limit(limit);
};


const findActiveVerifiedTechnicianById = (id, { session = null } = {}) => {
  let query = User.findOne({
    _id: id,
    role: 'technician',
    isActive: true,
    isEmailVerified: true
  });

  if (session) query = query.session(session);
  return query;
};

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
  findActiveVerifiedTechnicianById,
  findRegisteredCustomerById,
  searchRegisteredCustomers,
  save
};
