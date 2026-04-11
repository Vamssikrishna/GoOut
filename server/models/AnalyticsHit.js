import mongoose from 'mongoose';

const analyticsHitSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  visitorKey: { type: String, required: true },
  type: { type: String, enum: ['view', 'click'], required: true },
  at: { type: Date, default: Date.now }
}, { timestamps: true });

analyticsHitSchema.index({ businessId: 1, visitorKey: 1, type: 1, at: -1 });

export default mongoose.model('AnalyticsHit', analyticsHitSchema);