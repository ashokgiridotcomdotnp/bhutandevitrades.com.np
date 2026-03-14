import mongoose from 'mongoose';

let allowedAuthCodePurposes = ['signup', 'password-reset'];

let userAuthCodeSchema = new mongoose.Schema(
  {
    recordKey: {
      type: String,
      trim: true,
      lowercase: true,
      select: false,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    purpose: {
      type: String,
      required: true,
      enum: allowedAuthCodePurposes,
    },
    codeHash: {
      type: String,
      required: true,
      trim: true,
      select: false,
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
      select: false,
    },
    passwordSalt: {
      type: String,
      trim: true,
      default: '',
      select: false,
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

userAuthCodeSchema.index({ recordKey: 1 }, { unique: true, sparse: true, name: 'uq_user_auth_code_record_key' });
userAuthCodeSchema.index({ email: 1, purpose: 1, createdAt: -1 });
userAuthCodeSchema.index({ email: 1, purpose: 1, usedAt: 1, expiresAt: 1, createdAt: -1 }, { name: 'idx_user_auth_code_lookup' });
userAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.models.UserAuthCode || mongoose.model('UserAuthCode', userAuthCodeSchema);
