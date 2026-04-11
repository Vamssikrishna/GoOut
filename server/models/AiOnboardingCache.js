import mongoose from 'mongoose';

const aiOnboardingCacheSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    sentence: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);


aiOnboardingCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model('AiOnboardingCache', aiOnboardingCacheSchema);