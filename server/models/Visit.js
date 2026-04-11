import mongoose from 'mongoose';

const visitSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  placeType: { type: String, enum: ['local', 'public'], default: 'local' },
  placeKey: { type: String, required: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
  placeName: { type: String, default: '' },
  placeCategory: { type: String, default: '' },
  placeCoords: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },
  visitedAt: { type: Date, default: Date.now },
  userCoords: {
    type: { type: String, enum: ['Point'] },
    coordinates: [Number]
  },
  distanceWalked: { type: Number },
  comparatorGuided: { type: Boolean, default: false },
  postBenefitMatched: { type: Boolean, default: null },
  postBenefitNote: { type: String, default: '' },
  comparatorCreditsAwarded: { type: Boolean, default: false }
}, { timestamps: true });

visitSchema.index({ userId: 1, visitedAt: -1 });
visitSchema.index({ userId: 1, businessId: 1, visitedAt: -1 });
visitSchema.index({ userId: 1, placeKey: 1, visitedAt: -1 });

export default mongoose.model('Visit', visitSchema);