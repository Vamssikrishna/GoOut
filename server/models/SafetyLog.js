import mongoose from 'mongoose';

const safetyLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'BuddyGroup', required: true },
  type: { type: String, enum: ['sos', 'safe_by_triggered'], required: true },
  coordinates: {
    type: { type: String, enum: ['Point'] },
    coordinates: [Number]
  },
  resolvedAt: { type: Date }
}, { timestamps: true });

safetyLogSchema.index({ userId: 1, createdAt: -1 });
safetyLogSchema.index({ groupId: 1 });

export default mongoose.model('SafetyLog', safetyLogSchema);
