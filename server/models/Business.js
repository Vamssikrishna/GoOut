import mongoose from 'mongoose';

const businessSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: { type: String },
  category: { type: String, required: true },
  tags: [{ type: String }],
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  address: { type: String, required: true },
  phone: { type: String },
  avgPrice: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
  openingHours: { type: Map, of: String, default: {} },
  images: [{ type: String }],
  crowdLevel: { type: Number, default: 50, min: 0, max: 100 },
  crowdLastPing: { type: Date, default: Date.now },
  isFree: { type: Boolean, default: false },
  menu: [{ type: String }],
  greenInitiatives: [{ type: String }],
  localVerification: {
    status: { type: String, enum: ['none', 'pending', 'verified'], default: 'none' },
    redPin: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  localKarmaScore: { type: Number, default: 0 },
  analytics: {
    profileViews: { type: Number, default: 0 },
    offerClicks: { type: Number, default: 0 },
    peakHours: { type: Map, of: Number, default: {} }
  }
}, { timestamps: true });

businessSchema.index({ location: '2dsphere' });
businessSchema.index({ isFree: 1 });
businessSchema.index({ category: 1 });
businessSchema.index({ ownerId: 1 });
businessSchema.index({ 'localVerification.redPin': 1, localKarmaScore: -1 });

export default mongoose.model('Business', businessSchema);
