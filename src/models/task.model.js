'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const TASK_STATUSES = ['todo', 'in-progress', 'review', 'done'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];

const taskSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      minlength: [3, 'Task title must be at least 3 characters'],
      maxlength: [160, 'Task title must be at most 160 characters'],
    },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: [true, 'A task must belong to a project'] },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium' },
    startDate: { type: Date, default: Date.now },
    deadline: { type: Date, default: null },
    progress: {
      type: Number,
      min: [0, 'Progress cannot be negative'],
      max: [100, 'Progress cannot exceed 100'],
      default: 0,
    },
    dependencies: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    tags: { type: [String], default: [] },
    estimatedHours: { type: Number, min: 0, default: null },
    completedAt: { type: Date, default: null },
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

// Indexes for the filters that GET /api/tasks actually supports.
taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ project: 1, assignedTo: 1 });
taskSchema.index({ deadline: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ dependencies: 1 });
taskSchema.index({ createdAt: -1 });
taskSchema.index({ title: 'text', description: 'text', tags: 'text' }, { name: 'task_text_idx' });

taskSchema.path('deadline').validate(function deadlineAfterStart(value) {
  if (!value || !this.startDate) return true;
  return value >= this.startDate;
}, 'Deadline must be on or after the start date');

/**
 * Keep `status`, `progress` and `completedAt` consistent:
 *   done → progress 100 and a completion timestamp
 *   todo → progress back to 0, completion cleared
 *   anything else → completion cleared, progress left to the caller
 */
taskSchema.pre('save', function syncStatusFields(next) {
  if (this.isModified('status')) {
    if (this.status === 'done') {
      this.progress = 100;
      if (!this.completedAt) this.completedAt = new Date();
    } else {
      this.completedAt = null;
      if (this.status === 'todo') this.progress = 0;
    }
  }
  next();
});

/** A task with no deadline can never be overdue. */
taskSchema.virtual('isOverdue').get(function isOverdue() {
  if (!this.deadline || this.status === 'done') return false;
  return this.deadline.getTime() < Date.now();
});

taskSchema.virtual('durationDays').get(function durationDays() {
  const end = this.deadline || this.completedAt;
  if (!end || !this.startDate) return null;
  return Math.max(0, Math.round((end.getTime() - this.startDate.getTime()) / 86400000));
});

module.exports = mongoose.model('Task', taskSchema);
module.exports.TASK_STATUSES = TASK_STATUSES;
module.exports.TASK_PRIORITIES = TASK_PRIORITIES;
