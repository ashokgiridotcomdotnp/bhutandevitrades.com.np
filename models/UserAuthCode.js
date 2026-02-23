var mongoose = require('mongoose');

var userAuthCodeSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    purpose: {
      type: String,
      required: true,
      enum: ['login', 'signup', 'password-reset'],
    },
    codeHash: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
    minimize: false,
  }
);

userAuthCodeSchema.index({ email: 1, purpose: 1, createdAt: -1 });
userAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.UserAuthCode || mongoose.model('UserAuthCode', userAuthCodeSchema);
