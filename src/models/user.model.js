'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

const { Schema } = mongoose;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name must be at most 80 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [EMAIL_REGEX, 'Please provide a valid email address'],
    },
    // Absent for accounts that only ever authenticate through Firebase.
    password: {
      type: String,
      select: false,
      minlength: [8, 'Password must be at least 8 characters'],
    },
    firebaseUid: {
      type: String,
      default: undefined,
      trim: true,
    },
    role: {
      type: String,
      enum: { values: ['member', 'lead', 'admin'], message: 'Role must be member, lead or admin' },
      default: 'member',
      index: true,
    },
    avatarUrl: { type: String, default: null, trim: true },
    fcmTokens: {
      type: [String],
      default: [],
      validate: {
        validator: (tokens) => tokens.length <= 20,
        message: 'A user cannot have more than 20 registered devices',
      },
    },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        // Defence in depth — `password` is already `select: false`.
        delete ret.password;
        delete ret.fcmTokens;
        delete ret.firebaseUid;
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true, versionKey: false },
  }
);

userSchema.index({ firebaseUid: 1 }, { unique: true, sparse: true });
userSchema.index({ createdAt: -1 });

/** Hash the password whenever it is set or changed. */
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) return next();
  try {
    this.password = await bcrypt.hash(this.password, env.BCRYPT_SALT_ROUNDS);
    return next();
  } catch (err) {
    return next(err);
  }
});

/** Keep the device-token list clean, de-duplicated and bounded. */
userSchema.pre('save', function normaliseTokens(next) {
  if (this.isModified('fcmTokens')) {
    const unique = [...new Set((this.fcmTokens || []).filter((t) => typeof t === 'string' && t.trim()))];
    this.fcmTokens = unique.slice(-20);
  }
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password || !candidate) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

/** Register a device token, keeping the newest entries. */
userSchema.methods.addFcmToken = function addFcmToken(token) {
  if (!token) return false;
  if (!this.fcmTokens.includes(token)) {
    this.fcmTokens.push(token);
    this.markModified('fcmTokens');
  }
  return true;
};

userSchema.methods.removeFcmToken = function removeFcmToken(token) {
  if (!token) return false;
  const before = this.fcmTokens.length;
  this.fcmTokens = this.fcmTokens.filter((t) => t !== token);
  if (this.fcmTokens.length !== before) {
    this.markModified('fcmTokens');
    return true;
  }
  return false;
};

userSchema.virtual('isFirebaseUser').get(function isFirebaseUser() {
  return Boolean(this.firebaseUid) && !this.password;
});

module.exports = mongoose.model('User', userSchema);
