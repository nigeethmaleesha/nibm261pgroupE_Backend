const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const activeSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true
    },
    refreshTokenHash: {
      type: String,
      required: true,
      select: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      required: true
    },
    lastRotatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: 120
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: 254
    },
    contactNumber: {
      type: String,
      required: [true, 'Contact number is required'],
      trim: true,
      maxlength: 30
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 12,
      select: false
    },
    role: {
      type: String,
      enum: ['customer', 'owner_staff', 'technician'],
      default: 'customer',
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isEmailVerified: {
      type: Boolean,
      default: false
    },
    activeSessions: {
      type: [activeSessionSchema],
      default: [],
      select: false
    }
  },
  { timestamps: true }
);

// SCRUM-33: email must be unique and contact number must be indexed.
userSchema.index({ email: 1 }, { unique: true, name: 'unique_user_email' });
userSchema.index({ contactNumber: 1 }, { name: 'user_contact_number_idx' });

// Only one Owner/Staff account may exist in the system. The partial unique
// index protects this rule even if two setup requests arrive at the same time.
userSchema.index(
  { role: 1 },
  {
    unique: true,
    partialFilterExpression: { role: 'owner_staff' },
    name: 'one_owner_staff_only'
  }
);

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) {
    return;
  }

  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
