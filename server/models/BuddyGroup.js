import mongoose from 'mongoose';

const buddyGroupSchema = new mongoose.Schema({
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  activity: { type: String, required: true },
  description: { type: String },
  interests: [{ type: String }],
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  meetingPlace: { type: String },
  scheduledAt: { type: Date, required: true },
  maxMembers: { type: Number, default: 6 },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pendingRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['open', 'full', 'ongoing', 'completed'], default: 'open' },
  safeBy: { type: Date },
  safeByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

buddyGroupSchema.index({ location: '2dsphere' });
buddyGroupSchema.index({ interests: 1 });
buddyGroupSchema.index({ scheduledAt: 1 });

export default mongoose.model('BuddyGroup', buddyGroupSchema);
