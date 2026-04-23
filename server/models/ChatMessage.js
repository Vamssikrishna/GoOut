import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'BuddyGroup', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, required: true },
  message: { type: String, required: true },
  attachments: [{
    url: { type: String },
    filename: { type: String },
    mimetype: { type: String },
    type: { type: String, enum: ['image', 'video', 'audio', 'file'] } // auto-detected from mimetype
  }],
  isSOS: { type: Boolean, default: false },
  pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  pinnedAt: { type: Date, default: null },
  deletedForUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  sharedLocation: {
    type: { type: String, enum: ['Point'] },
    coordinates: [Number]
  },
  sosLocation: {
    type: { type: String, enum: ['Point'] },
    coordinates: [Number]
  }
}, { timestamps: true });

chatMessageSchema.index({ groupId: 1, createdAt: -1 });

export default mongoose.model('ChatMessage', chatMessageSchema);