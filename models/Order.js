import mongoose from 'mongoose';


function toTrimmedString(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value).trim();
}

function normalizeEmail(value) {
  return toTrimmedString(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

let orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
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
      validate: {
        validator: isValidEmail,
        message: 'A valid customer email is required',
      },
    },
    customerName: {
      type: String,
      trim: true,
      default: '',
      maxlength: 140,
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: '',
      maxlength: 40,
    },
    note: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true,
    },
    productId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    productName: {
      type: String,
      trim: true,
      required: true,
      default: 'Product',
      maxlength: 180,
    },
    productType: {
      type: String,
      trim: true,
      default: 'Other',
      maxlength: 120,
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
      maxlength: 120,
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
      maxlength: 120,
    },
    totalPriceValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      trim: true,
      enum: ['pending', 'submitted', 'email-failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    adminStatus: {
      type: String,
      trim: true,
      enum: ['pending', 'processing', 'accepted'],
      default: 'pending',
      index: true,
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
      index: true,
    },
    adminMessage: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
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
  },
  {
    strict: 'throw',
    versionKey: false,
    minimize: false,
    timestamps: true,
  }
);

orderSchema.pre('validate', function (next) {
  this.userId = toTrimmedString(this.userId);
  this.customerEmail = normalizeEmail(this.customerEmail);
  this.customerName = toTrimmedString(this.customerName);
  this.phoneNumber = toTrimmedString(this.phoneNumber);
  this.note = toTrimmedString(this.note);
  this.productId = toTrimmedString(this.productId);
  this.productName = toTrimmedString(this.productName) || 'Product';
  this.productType = toTrimmedString(this.productType) || 'Other';
  this.unitPriceLabel = toTrimmedString(this.unitPriceLabel) || 'Contact for price';
  this.totalLabel = toTrimmedString(this.totalLabel) || 'Contact for price';
  this.adminMessage = toTrimmedString(this.adminMessage);

  if (typeof this.quantity === 'number' && Number.isFinite(this.quantity)) {
    this.quantity = Math.floor(this.quantity);
  }

  if (typeof this.unitPriceValue === 'number' && Number.isFinite(this.unitPriceValue)) {
    this.unitPriceValue = Math.round(this.unitPriceValue * 100) / 100;
  }

  if (typeof this.totalPriceValue === 'number' && Number.isFinite(this.totalPriceValue)) {
    this.totalPriceValue = Math.round(this.totalPriceValue * 100) / 100;
  }

  if (this.adminStatus === 'accepted' && !this.adminAcceptedAt) {
    this.adminAcceptedAt = new Date();
  }

  if (this.adminStatus !== 'accepted' && this.adminStatus !== 'processing' && this.adminAcceptedAt) {
    this.adminAcceptedAt = null;
  }

  next();
});

orderSchema.index({ user: 1, createdAt: -1 }, { name: 'idx_order_user_created_at' });
orderSchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_order_user_id_created_at' });
orderSchema.index({ customerEmail: 1, createdAt: -1 }, { name: 'idx_order_customer_email_created_at' });
orderSchema.index({ adminStatus: 1, createdAt: -1 }, { name: 'idx_order_admin_status_created_at' });
orderSchema.index({ product: 1, createdAt: -1 }, { name: 'idx_order_product_created_at' });
orderSchema.index({ product: 1, adminStatus: 1, createdAt: -1 }, { name: 'idx_order_product_admin_status_created_at' });
orderSchema.index({ productId: 1, adminStatus: 1, createdAt: -1 }, { name: 'idx_order_product_id_admin_status_created_at' });
export default mongoose.models.Order || mongoose.model('Order', orderSchema);
