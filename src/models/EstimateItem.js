const mongoose = require('mongoose');

const estimateItemSchema = new mongoose.Schema(
  {
    estimate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Estimate',
      required: true,
      immutable: true
    },
    lineNumber: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'Line number must be a whole number'
      },
      immutable: true
    },
    type: {
      type: String,
      enum: ['PART', 'LABOUR'],
      required: true,
      immutable: true
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
      immutable: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: 'Quantity must be a positive whole number'
      },
      immutable: true
    },
    unitPriceMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: 'unitPriceMinor must use integer minor units'
      },
      immutable: true
    },
    lineTotalMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: 'lineTotalMinor must use integer minor units'
      },
      immutable: true
    },
    isImmutable: {
      type: Boolean,
      default: true,
      required: true,
      immutable: true
    }
  },
  {
    timestamps: true,
    collection: 'estimate_items'
  }
);

estimateItemSchema.index(
  { estimate: 1, lineNumber: 1 },
  { unique: true, name: 'unique_estimate_line_number' }
);
estimateItemSchema.index(
  { estimate: 1 },
  { name: 'estimate_item_estimate_idx' }
);

module.exports = mongoose.model('EstimateItem', estimateItemSchema);
