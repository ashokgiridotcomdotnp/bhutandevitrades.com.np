var mongoose = require('mongoose');

var orderSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      index: true,
    },
    customerName: {
      type: String,
      trim: true,
      default: '',
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: '',
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    productId: {
      type: String,
      trim: true,
      default: '',
    },
    productName: {
      type: String,
      trim: true,
      required: true,
      default: 'Product',
    },
    productType: {
      type: String,
      trim: true,
      default: 'Other',
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 999,
      default: 1,
    },
    unitPriceLabel: {
      type: String,
      trim: true,
      default: 'Contact for price',
    },
    unitPriceValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    totalLabel: {
      type: String,
      trim: true,
      default: 'Contact for price',
    },
    totalPriceValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      trim: true,
      enum: ['pending', 'submitted', 'email-failed'],
      default: 'pending',
      index: true,
    },
    adminStatus: {
      type: String,
      trim: true,
      enum: ['pending', 'accepted'],
      default: 'pending',
      index: true,
    },
    adminMessage: {
      type: String,
      trim: true,
      default: '',
    },
    adminAcceptedAt: {
      type: Date,
      default: null,
    },
    adminEmailNotificationSent: {
      type: Boolean,
      default: false,
    },
    emailNotificationSent: {
      type: Boolean,
      default: false,
    },
    customerConfirmationSent: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
    minimize: false,
  }
);

orderSchema.pre('save', function () {
  this.updatedAt = new Date();
});

orderSchema.index({ customerEmail: 1, createdAt: -1 });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
