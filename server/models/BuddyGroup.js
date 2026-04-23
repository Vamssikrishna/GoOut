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
  invitedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  declinedInvites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  scheduledAt: { type: Date, required: true },
  chatExpiresAt: { type: Date, default: null },
  maxMembers: { type: Number, default: 3 },
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
  carbonMeetupBonusAwarded: { type: Boolean, default: false },
  callSettings: {
    voiceApprovedForAll: { type: Boolean, default: false },
    videoApprovedForAll: { type: Boolean, default: false }
  },
  pendingCallRequest: {
    callType: { type: String, enum: ['voice', 'video'], default: null },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: null },
    votes: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      response: { type: String, enum: ['yes', 'no'], required: true },
      at: { type: Date, default: Date.now }
    }]
  },
  /** Users who already received the 10-minute meetup reminder. */
  reminder10mSentTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  /** Users who already received the 1-day meetup reminder. */
  reminder1dSentTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  /** Users who already received the 1-hour meetup reminder. */
  reminder1hSentTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

buddyGroupSchema.index({ location: '2dsphere' });
buddyGroupSchema.index({ interests: 1 });
buddyGroupSchema.index({ scheduledAt: 1 });
buddyGroupSchema.index({ inviteTargetUserId: 1, scheduledAt: 1 });
buddyGroupSchema.index({ invitedUsers: 1, scheduledAt: 1 });

export default mongoose.model('BuddyGroup', buddyGroupSchema);