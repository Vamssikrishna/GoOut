import mongoose from 'mongoose';

const visitSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  visitedAt: { type: Date, default: Date.now },
  userCoords: {
    type: { type: String, enum: ['Point'] },
    coordinates: [Number]
  },
  distanceWalked: { type: Number }
}, { timestamps: true });

visitSchema.index({ userId: 1, visitedAt: -1 });
visitSchema.index({ userId: 1, businessId: 1, visitedAt: -1 });

export default mongoose.model('Visit', visitSchema);
