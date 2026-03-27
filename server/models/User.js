import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['explorer', 'merchant'], default: 'explorer' },
  avatar: { type: String, default: '' },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },
  interests: [{ type: String }],
  emergencyContact: { type: String, default: '' },
  weight: { type: Number, default: 65 },
  verified: { type: Boolean, default: false },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
  greenStats: {
    totalCaloriesBurned: { type: Number, default: 0 },
    totalCO2Saved: { type: Number, default: 0 },
    totalWalks: { type: Number, default: 0 }
  },
  lastActive: { type: Date, default: Date.now },
  passwordResetToken: { type: String, select: false },
  passwordResetExpires: { type: Date, select: false },
  loginOtpHash: { type: String, select: false },
  loginOtpExpires: { type: Date, select: false },
}, { timestamps: true });

userSchema.index({ location: '2dsphere' });
userSchema.index({ interests: 1 });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model('User', userSchema);
