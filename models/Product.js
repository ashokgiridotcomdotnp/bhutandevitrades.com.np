import mongoose from 'mongoose';


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

function normalizeAssetPath(value) {
  let trimmed = toTrimmedString(value).replace(/\\/g, '/');

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.charAt(0) !== '/') {
    return '/' + trimmed.replace(/^\/+/, '');
  }

  return trimmed;
}

function mergeQuantityGuard(query, minimumQuantity) {
  let nextQuery = Object.assign({}, query || {});
  let existingCondition = nextQuery.quantity;
  let requiredMinimum = Math.max(0, Number(minimumQuantity) || 0);

  if (typeof existingCondition === 'number') {
    if (existingCondition < requiredMinimum) {
      throw new Error('quantity update would allow negative stock');
    }

    return nextQuery;
  }

  if (existingCondition && typeof existingCondition === 'object' && !Array.isArray(existingCondition)) {
    nextQuery.quantity = mongoose.trusted(Object.assign({}, existingCondition));

    if (typeof nextQuery.quantity.$gte === 'number') {
      nextQuery.quantity.$gte = Math.max(nextQuery.quantity.$gte, requiredMinimum);
    } else {
      nextQuery.quantity.$gte = requiredMinimum;
    }

    return nextQuery;
  }

  nextQuery.quantity = mongoose.trusted({ $gte: requiredMinimum });
  return nextQuery;
}

function applyQuantityUpdateGuards() {
  let update = this.getUpdate() || {};
  let setPayload = update.$set || {};
  let incPayload = update.$inc || {};
  let nextQuantity = null;
  let quantityDelta = null;

  if (Array.isArray(update)) {
    throw new Error('Aggregation pipeline updates are not supported for Product quantity changes');
  }

  if (Object.prototype.hasOwnProperty.call(update, 'quantity')) {
    nextQuantity = Number(update.quantity);

    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
      throw new Error('quantity must be a non-negative integer');
    }
  }

  if (Object.prototype.hasOwnProperty.call(setPayload, 'quantity')) {
    nextQuantity = Number(setPayload.quantity);

    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
      throw new Error('quantity must be a non-negative integer');
    }
  }

  if (Object.prototype.hasOwnProperty.call(incPayload, 'quantity')) {
    quantityDelta = Number(incPayload.quantity);

    if (!Number.isInteger(quantityDelta)) {
      throw new Error('quantity increment must be an integer');
    }

    if (quantityDelta < 0) {
      this.setQuery(mergeQuantityGuard(this.getQuery(), Math.abs(quantityDelta)));
    }
  }
}

let productSchema = new mongoose.Schema(
  {
    legacyId: {
      type: String,
      trim: true,
      default: undefined,
      maxlength: 180,
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
      required: false,
      default: null,
      index: true,
    },
    sku: {
      type: String,
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
      maxlength: 4000,
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
    images: {
      type: [String],
      default: [],
      validate: {
        validator: function (values) {
          return (values || []).every(function (value) {
            return Boolean(normalizeAssetPath(value));
          });
        },
        message: 'Each product image must be a valid asset path or HTTP(S) URL',
      },
    },
    searchKeywords: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      trim: true,
      enum: ['active', 'inactive', 'archived'],
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
    minimize: false,
    timestamps: true,
  }
);
// Pre-validate hook
productSchema.pre('validate', async function () {
  const seenKeywords = Object.create(null);
  let imageCandidates = [];

  this.name = toTrimmedString(this.name);
  this.normalizedName = normalizeName(this.name);
  this.slug = slugify(this.name || this.slug);

  if (typeof this.legacyId === 'string') {
    this.legacyId = toTrimmedString(this.legacyId) || undefined;
  }

  if (typeof this.sku === 'string') {
    this.sku = toTrimmedString(this.sku).toUpperCase() || undefined;
  }

  if (typeof this.quantity === 'number' && Number.isFinite(this.quantity)) {
    this.quantity = Math.floor(this.quantity);
  }

  if (typeof this.price === 'number' && Number.isFinite(this.price)) {
    this.price = Math.round(this.price * 100) / 100;
  }

  if (typeof this.compareAtPrice === 'number' && Number.isFinite(this.compareAtPrice)) {
    this.compareAtPrice = Math.round(this.compareAtPrice * 100) / 100;
  }

  this.imageUrl = normalizeAssetPath(this.imageUrl);

  imageCandidates = (this.images || []).map(normalizeAssetPath).filter(Boolean);

  if (this.imageUrl) imageCandidates.unshift(this.imageUrl);

  this.images = [...new Set(imageCandidates)]; // deduplicate
  this.imageUrl = this.images[0] || this.imageUrl || '';

  this.searchKeywords = (this.searchKeywords || [])
    .map(sanitizeKeyword)
    .filter((k) => k && !seenKeywords[k] && (seenKeywords[k] = true))
    .slice(0, 40);

  if (this.compareAtPrice !== null && this.compareAtPrice < this.price) {
    throw new Error('compareAtPrice cannot be lower than price'); // throw instead of next(error)
  }
});

['findOneAndUpdate', 'updateOne', 'updateMany'].forEach((hook) => {
  productSchema.pre(hook, async function () {
    applyQuantityUpdateGuards.call(this); // keep synchronous logic
  });
});

productSchema.index({ legacyId: 1 }, { unique: true, sparse: true, name: 'uq_product_legacy_id' });
productSchema.index({ sku: 1 }, { unique: true, sparse: true, name: 'uq_product_sku' });
productSchema.index({ category: 1, normalizedName: 1 }, { unique: true, name: 'uq_product_category_name' });
productSchema.index({ category: 1, slug: 1 }, { unique: true, name: 'uq_product_category_slug' });
productSchema.index({ isActive: 1, status: 1, createdAt: -1, name: 1 }, { name: 'idx_product_visibility_created_name' });
productSchema.index(
  { brand: 1, slug: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { brand: { $exists: true, $type: 'objectId' } },
    name: 'uq_product_brand_slug',
  }
);
productSchema.index({ category: 1, status: 1, updatedAt: -1 }, { name: 'idx_product_category_status_updated' });
productSchema.index({ quantity: 1, status: 1, isActive: 1 }, { name: 'idx_product_quantity_status_active' });
productSchema.index(
  { name: 'text', description: 'text', spec: 'text', searchKeywords: 'text' },
  { name: 'idx_product_text_search' }
);
export default mongoose.models.Product || mongoose.model('Product', productSchema);
