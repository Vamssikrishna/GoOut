import mongoose from 'mongoose';

const offerSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  title: { type: String, required: true },
  description: { type: String },
  discountPercent: { type: Number, default: 0 },
  originalPrice: { type: Number },
  offerPrice: { type: Number, required: true },
  validUntil: { type: Date, required: true },
  isFlash: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

offerSchema.index({ businessId: 1, isActive: 1 });
offerSchema.index({ validUntil: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('Offer', offerSchema);