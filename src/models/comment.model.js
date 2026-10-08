'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const commentSchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, ref: 'Task', required: [true, 'A comment must belong to a task'] },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: {
      type: String,
      required: [true, 'Comment body is required'],
      trim: true,
      minlength: [1, 'Comment cannot be empty'],
      maxlength: [2000, 'Comment must be at most 2000 characters'],
    },
    // Single level of threading: a reply points at a top-level comment.
    parent: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
    mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    editedAt: { type: Date, default: null },
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

commentSchema.index({ task: 1, createdAt: -1 });
commentSchema.index({ author: 1 });
commentSchema.index({ parent: 1 });

module.exports = mongoose.model('Comment', commentSchema);
