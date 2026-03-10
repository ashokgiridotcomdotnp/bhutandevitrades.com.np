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

var categorySchema = new mongoose.Schema(
  {
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

categorySchema.pre('validate', function (next) {
  this.name = toTrimmedString(this.name);
  this.normalizedName = normalizeName(this.name);
  this.slug = slugify(this.name || this.slug);
  next();
});

categorySchema.index({ normalizedName: 1 }, { unique: true, name: 'uq_category_normalized_name' });
categorySchema.index({ slug: 1 }, { unique: true, name: 'uq_category_slug' });
categorySchema.index({ name: 'text', description: 'text' }, { name: 'idx_category_text' });
categorySchema.index({ isActive: 1, createdAt: -1 }, { name: 'idx_category_active_created' });

module.exports = mongoose.models.Category || mongoose.model('Category', categorySchema);
