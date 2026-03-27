import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'BuddyGroup', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, required: true },
  message: { type: String, required: true },
  isSOS: { type: Boolean, default: false },
  sosLocation: {
    type: { type: String, enum: ['Point'] },
    coordinates: [Number]
  }
}, { timestamps: true });

chatMessageSchema.index({ groupId: 1, createdAt: -1 });

export default mongoose.model('ChatMessage', chatMessageSchema);
