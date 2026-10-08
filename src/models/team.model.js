'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Team membership is the single source of truth for "who is on this team".
 * There is deliberately no mirrored `User.teams` array — one write path means
 * no drift.
 */
const teamMemberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['member', 'lead'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const teamSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      unique: true,
      trim: true,
      minlength: [2, 'Team name must be at least 2 characters'],
      maxlength: [80, 'Team name must be at most 80 characters'],
    },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    lead: { type: Schema.Types.ObjectId, ref: 'User', required: [true, 'A team needs a lead'] },
    members: { type: [teamMemberSchema], default: [] },
    projects: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
    isActive: { type: Boolean, default: true },
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

teamSchema.index({ lead: 1 });
teamSchema.index({ 'members.user': 1 });
teamSchema.index({ isActive: 1 });

/** True when the given user is the lead or listed as a member. */
teamSchema.methods.hasMember = function hasMember(userId) {
  const id = String(userId?._id || userId);
  return String(this.lead) === id || (this.members || []).some((m) => String(m.user) === id);
};

// `members` can be absent when the document was populated with a field
// selection that omits it (project.service populates the team as
// 'name isActive'), so this must not assume the array is there.
teamSchema.virtual('memberCount').get(function memberCount() {
  return (this.members || []).length;
});

module.exports = mongoose.model('Team', teamSchema);
