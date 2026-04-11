import mongoose from 'mongoose';

const buddyGroupSchema = new mongoose.Schema({
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  activity: { type: String, required: true },
  description: { type: String },
  interests: [{ type: String }],
  intentSnippet: { type: String, default: '' },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  meetingPlace: { type: String },
  /** Verified meetup spot only: Red Pin merchant or public plaza — never a private address. */
  safeVenue: {
    kind: { type: String, enum: ['red_pin', 'public_plaza'], default: 'public_plaza' },
    name: { type: String, default: '' },
    lat: { type: Number },
    lng: { type: Number },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
    placeId: { type: String, default: '' },
    safetyNote: { type: String, default: '' }
  },
  inviteTargetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  scheduledAt: { type: Date, required: true },
  chatExpiresAt: { type: Date, default: null },
  maxMembers: { type: Number, default: 6 },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pendingRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['open', 'full', 'ongoing', 'completed'], default: 'open' },
  safeBy: { type: Date },
  safeByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  postMeetupFeedback: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    didMeet: { type: Boolean },
    locationSafe: { type: Boolean },
    walkedThere: { type: Boolean, default: false },
    at: { type: Date, default: Date.now }
  }],
  carbonMeetupBonusAwarded: { type: Boolean, default: false }
}, { timestamps: true });

buddyGroupSchema.index({ location: '2dsphere' });
buddyGroupSchema.index({ interests: 1 });
buddyGroupSchema.index({ scheduledAt: 1 });
buddyGroupSchema.index({ inviteTargetUserId: 1, scheduledAt: 1 });

export default mongoose.model('BuddyGroup', buddyGroupSchema);