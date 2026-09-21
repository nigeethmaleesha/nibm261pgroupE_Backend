const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254
    },
    purpose: {
      type: String,
      enum: ['REGISTER', 'LOGIN'],
      required: true
    },
    // Plaintext is intentional for this coursework implementation so the
    // active OTP can be inspected in MongoDB, matching the supplied PrintDrop
    // reference project. Never return this field from an API response.
    otp: {
      type: String,
      required: true,
      match: /^\d{6}$/
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0
    },
    resendCount: {
      type: Number,
      default: 0,
      min: 0
    },
    lastSentAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    collection: 'otp'
  }
);

// One active OTP per email and purpose. A resend replaces the existing code.
otpSchema.index(
  { email: 1, purpose: 1 },
  { unique: true, name: 'unique_email_otp_purpose' }
);

module.exports = mongoose.model('Otp', otpSchema);
