var mongoose = require('mongoose');

var adminStateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    // Legacy field kept temporarily for backward compatibility.
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
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

adminStateSchema.pre('save', function () {
  this.updatedAt = new Date();
});

adminStateSchema.index({ key: 1 }, { unique: true });
adminStateSchema.index({ updatedAt: -1 });

module.exports = mongoose.models.AdminState || mongoose.model('AdminState', adminStateSchema);
