import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Business from '../models/Business.js';
import Visit from '../models/Visit.js';
import Offer from '../models/Offer.js';
import BuddyGroup from '../models/BuddyGroup.js';
import ChatMessage from '../models/ChatMessage.js';
import SafetyLog from '../models/SafetyLog.js';
import AnalyticsHit from '../models/AnalyticsHit.js';
import DailyStats from '../models/DailyStats.js';
import CrowdDispute from '../models/CrowdDispute.js';

dotenv.config();

async function clearAll() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/goout');
  await ChatMessage.deleteMany({});
  await Visit.deleteMany({});
  await SafetyLog.deleteMany({});
  await AnalyticsHit.deleteMany({});
  await DailyStats.deleteMany({});
  await CrowdDispute.deleteMany({});
  await BuddyGroup.deleteMany({});
  await Offer.deleteMany({});
  await Business.deleteMany({});
  await User.deleteMany({});
  console.log('All user data deleted.');
  process.exit(0);
}

clearAll().catch((e) => { console.error(e); process.exit(1); });
