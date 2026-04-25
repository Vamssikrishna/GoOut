import mongoose from 'mongoose';

const placePhotoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  placeType: { type: String, enum: ['local', 'public'], required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  placeKey: { type: String, required: true, index: true },
  placeName: { type: String, default: '' },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  imageUrl: { type: String, required: true },
  visibility: { type: String, enum: ['private', 'public'], default: 'private', index: true }
}, { timestamps: true });

placePhotoSchema.index({ placeKey: 1, visibility: 1, createdAt: -1 });

export default mongoose.model('PlacePhoto', placePhotoSchema);
