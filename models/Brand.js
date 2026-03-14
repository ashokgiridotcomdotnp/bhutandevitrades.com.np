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

let brandSchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 80,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
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

brandSchema.pre('validate', function (next) {
  this.name = toTrimmedString(this.name);
  this.normalizedName = normalizeName(this.name);
  this.slug = slugify(this.name || this.slug);
  next();
});

brandSchema.index({ category: 1, normalizedName: 1 }, { unique: true, name: 'uq_brand_category_normalized_name' });
brandSchema.index({ category: 1, slug: 1 }, { unique: true, name: 'uq_brand_category_slug' });
brandSchema.index({ category: 1, isActive: 1, createdAt: -1 }, { name: 'idx_brand_category_active_created' });
brandSchema.index({ name: 'text', description: 'text' }, { name: 'idx_brand_text' });
export default mongoose.models.Brand || mongoose.model('Brand', brandSchema);
