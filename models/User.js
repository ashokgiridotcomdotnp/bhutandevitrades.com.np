var mongoose = require('mongoose');

var userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    passwordHash: {
      type: String,
      trim: true,
      default: '',
    },
    passwordSalt: {
      type: String,
      trim: true,
      default: '',
    },
    authProvider: {
      type: String,
      trim: true,
      default: 'email-password',
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    versionKey: false,
    minimize: false,
    timestamps: true,
  }
);

userSchema.index({ updatedAt: -1 });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
