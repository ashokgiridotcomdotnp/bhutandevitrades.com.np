var mongoose = require('mongoose');

function toTrimmedString(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value).trim();
}

function normalizeName(value) {
  return toTrimmedString(value).toLowerCase().replace(/\s+/g, ' ');
}

function slugify(value) {
  return toTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeKeyword(value) {
  return normalizeName(value).replace(/[^a-z0-9\s-]/g, '').trim();
}

var productSchema = new mongoose.Schema(
  {
    legacyId: {
      type: String,
      trim: true,
      default: undefined,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: true,
      index: true,
    },
    sku: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
      default: undefined,
      maxlength: 64,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 140,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 140,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 180,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
    },
    spec: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      max: 1000000000,
    },
    compareAtPrice: {
      type: Number,
      default: null,
      min: 0,
      max: 1000000000,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      max: 1000000000,
    },
    imageUrl: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2048,
    },
    searchKeywords: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      trim: true,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    strict: 'throw',
    versionKey: false,
    timestamps: true,
  }
);

productSchema.pre('validate', function (next) {
  this.name = toTrimmedString(this.name);
  this.normalizedName = normalizeName(this.name);
  this.slug = slugify(this.name || this.slug);

  if (typeof this.quantity === 'number' && Number.isFinite(this.quantity)) {
    this.quantity = Math.floor(this.quantity);
  }

  if (this.searchKeywords && Array.isArray(this.searchKeywords)) {
    var seen = Object.create(null);
    this.searchKeywords = this.searchKeywords
      .map(function (keyword) {
        return sanitizeKeyword(keyword);
      })
      .filter(function (keyword) {
        if (!keyword || seen[keyword]) {
          return false;
        }
        seen[keyword] = true;
        return true;
      })
      .slice(0, 40);
  }

  if (this.compareAtPrice !== null && this.compareAtPrice < this.price) {
    return next(new Error('compareAtPrice cannot be lower than price'));
  }

  next();
});

productSchema.index({ legacyId: 1 }, { unique: true, sparse: true });
productSchema.index({ sku: 1 }, { unique: true, sparse: true, name: 'uq_product_sku' });
productSchema.index({ brand: 1, slug: 1 }, { unique: true, name: 'uq_product_brand_slug' });
productSchema.index({ brand: 1, normalizedName: 1 }, { unique: true, name: 'uq_product_brand_normalized_name' });
productSchema.index({ category: 1, normalizedName: 1 }, { name: 'idx_product_category_normalized_name' });
productSchema.index({ category: 1, brand: 1 }, { name: 'idx_product_category_brand' });
productSchema.index({ status: 1, isActive: 1, updatedAt: -1 }, { name: 'idx_product_status_active_updated' });
productSchema.index({ name: 'text', description: 'text', spec: 'text', searchKeywords: 'text' }, { name: 'idx_product_text_search' });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
