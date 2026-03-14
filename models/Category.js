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

let categorySchema = new mongoose.Schema(
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
      maxlength: 1000,
    },
    items: {
      type: [String],
      default: [],
    },
    sortOrder: {
      type: Number,
      default: 0,
      min: 0,
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
categorySchema.pre('validate', async function () {
  const seenItems = Object.create(null);

  this.name = toTrimmedString(this.name);
  this.normalizedName = normalizeName(this.name);
  this.slug = slugify(this.name || this.slug);

  if (typeof this.sortOrder === 'number' && Number.isFinite(this.sortOrder)) {
    this.sortOrder = Math.floor(this.sortOrder);
  }

  this.items = (this.items || [])
    .map(item => toTrimmedString(item))
    .filter(item => {
      const itemKey = normalizeName(item);
      if (!item || item.length > 120 || seenItems[itemKey]) return false;
      seenItems[itemKey] = true;
      return true;
    });

  // ❌ No next() here
});

categorySchema.index({ normalizedName: 1 }, { unique: true, name: 'uq_category_normalized_name' });
categorySchema.index({ slug: 1 }, { unique: true, name: 'uq_category_slug' });
categorySchema.index({ isActive: 1, sortOrder: 1, name: 1 }, { name: 'idx_category_active_sort_name' });
categorySchema.index({ updatedAt: -1 }, { name: 'idx_category_updated_at' });
categorySchema.index({ name: 'text', description: 'text', items: 'text' }, { name: 'idx_category_text_search' });
export default mongoose.models.Category || mongoose.model('Category', categorySchema);
