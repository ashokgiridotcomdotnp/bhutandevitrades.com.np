var mongoose = require('mongoose');

var adminStateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    categories: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    products: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    priceOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    imageOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    productOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    deletedProductIds: {
      type: [String],
      default: [],
    },
    deletedCategoryNames: {
      type: [String],
      default: [],
    },
    // Legacy field retained for backward compatibility while migrating to flat fields.
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    // Legacy field kept temporarily for backward compatibility.
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    minimize: false,
  }
);

adminStateSchema.index({ key: 1 }, { unique: true });
adminStateSchema.index({ updatedAt: -1 });

module.exports = mongoose.models.AdminState || mongoose.model('AdminState', adminStateSchema);
