import mongoose from 'mongoose';

const crowdDisputeSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  level: { type: Number, required: true, min: 0, max: 100 },
}, { timestamps: true });

crowdDisputeSchema.index({ businessId: 1, userId: 1 }, { unique: true });
crowdDisputeSchema.index({ businessId: 1, createdAt: -1 });

export default mongoose.model('CrowdDispute', crowdDisputeSchema);
