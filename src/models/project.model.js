'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const PROJECT_STATUSES = ['planning', 'active', 'on-hold', 'completed', 'archived'];

const projectSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      minlength: [3, 'Project name must be at least 3 characters'],
      maxlength: [120, 'Project name must be at most 120 characters'],
    },
    key: {
      type: String,
      required: [true, 'Project key is required'],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: [2, 'Project key must be at least 2 characters'],
      maxlength: [10, 'Project key must be at most 10 characters'],
      match: [/^[A-Z0-9]+$/, 'Project key may only contain letters and digits'],
    },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    status: { type: String, enum: PROJECT_STATUSES, default: 'planning' },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    team: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null },
    tags: { type: [String], default: [] },
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

projectSchema.index({ owner: 1 });
projectSchema.index({ members: 1 });
projectSchema.index({ team: 1 });
projectSchema.index({ status: 1 });
projectSchema.index({ status: 1, endDate: 1 });
projectSchema.index({ name: 'text', description: 'text', tags: 'text' }, { name: 'project_text_idx' });

projectSchema.path('endDate').validate(function endAfterStart(value) {
  if (!value || !this.startDate) return true;
  return value >= this.startDate;
}, 'End date must be on or after the start date');

/** Owner is always implicitly a member. */
projectSchema.pre('save', function ensureOwnerIsMember(next) {
  const ownerId = String(this.owner);
  if (!this.members.some((m) => String(m) === ownerId)) this.members.push(this.owner);
  next();
});

projectSchema.methods.hasMember = function hasMember(userId) {
  const id = String(userId?._id || userId);
  return String(this.owner) === id || this.members.some((m) => String(m) === id);
};

module.exports = mongoose.model('Project', projectSchema);
module.exports.PROJECT_STATUSES = PROJECT_STATUSES;
