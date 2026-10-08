'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const timeEntrySchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, min: 0, default: null },
    note: { type: String, trim: true, maxlength: 500, default: '' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
  }
);

timeEntrySchema.index({ task: 1, user: 1 });
timeEntrySchema.index({ user: 1, startedAt: -1 });
timeEntrySchema.index({ task: 1, startedAt: -1 });
// A user can only ever have one timer running at a time. The partial filter
// keeps the constraint scoped to the open entry, so unlimited closed entries
// per user are still allowed. Requires `endedAt: null` (not `undefined`).
timeEntrySchema.index(
  { user: 1, endedAt: 1 },
  { unique: true, partialFilterExpression: { endedAt: null }, name: 'one_running_timer_per_user' }
);

timeEntrySchema.virtual('running').get(function running() {
  return this.endedAt === null;
});

/** Elapsed seconds — live for a running timer, frozen once stopped. */
timeEntrySchema.virtual('elapsedSeconds').get(function elapsedSeconds() {
  if (this.durationSeconds != null) return this.durationSeconds;
  if (!this.endedAt) return Math.max(0, Math.round((Date.now() - this.startedAt.getTime()) / 1000));
  return Math.max(0, Math.round((this.endedAt.getTime() - this.startedAt.getTime()) / 1000));
});

timeEntrySchema.pre('save', function computeDuration(next) {
  if (this.endedAt && this.durationSeconds == null) {
    this.durationSeconds = Math.max(0, Math.round((this.endedAt.getTime() - this.startedAt.getTime()) / 1000));
  }
  next();
});

module.exports = mongoose.model('TimeEntry', timeEntrySchema);
