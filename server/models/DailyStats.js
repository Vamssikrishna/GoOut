import mongoose from 'mongoose';

const dailyStatsSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  date: { type: String, required: true },
  profileViews: { type: Number, default: 0 },
  offerClicks: { type: Number, default: 0 }
}, { timestamps: true });

dailyStatsSchema.index({ businessId: 1, date: 1 }, { unique: true });

export default mongoose.model('DailyStats', dailyStatsSchema);