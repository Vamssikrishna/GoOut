import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Business from '../models/Business.js';
import BuddyGroup from '../models/BuddyGroup.js';
import ChatMessage from '../models/ChatMessage.js';
import Offer from '../models/Offer.js';
import Visit from '../models/Visit.js';
import SafetyLog from '../models/SafetyLog.js';

const router = express.Router();

const ADMIN_EMAIL = 'ruthertom123@gmail.com';
const ADMIN_PASSWORD = 'ruthertom123@gmail.com';
const ADMIN_TOKEN_TTL = '12h';

function signAdminToken() {
  return jwt.sign(
    { adminModule: true, email: ADMIN_EMAIL },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: ADMIN_TOKEN_TTL }
  );
}

function requireAdmin(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Admin login required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    if (decoded?.adminModule !== true || decoded?.email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.admin = { email: ADMIN_EMAIL };
    return next();
  } catch {
    return res.status(401).json({ error: 'Admin session expired' });
  }
}

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ''));
}

function cleanUser(user) {
  if (!user) return null;
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    verified: Boolean(user.verified),
    buddyMode: Boolean(user.buddyMode),
    socialPoints: user.socialPoints || 0,
    carbonCredits: user.carbonCredits || 0,
    businessId: user.businessId || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastActive: user.lastActive
  };
}

function cleanBusiness(business) {
  if (!business) return null;
  return {
    _id: business._id,
    name: business.name,
    mapDisplayName: business.mapDisplayName,
    category: business.category,
    address: business.address,
    avgPrice: business.avgPrice || 0,
    rating: business.rating || 0,
    ownerId: business.ownerId || null,
    localVerification: business.localVerification || {},
    crowdLevel: business.crowdLevel ?? 50,
    isFree: Boolean(business.isFree),
    createdAt: business.createdAt,
    updatedAt: business.updatedAt
  };
}

router.post('/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }
  return res.json({
    token: signAdminToken(),
    admin: { email: ADMIN_EMAIL },
    expiresIn: ADMIN_TOKEN_TTL
  });
});

router.get('/me', requireAdmin, (_req, res) => {
  res.json({ admin: { email: ADMIN_EMAIL } });
});

router.get('/dashboard', requireAdmin, async (_req, res) => {
  const now = new Date();
  const lastDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    totalUsers,
    merchants,
    verifiedUsers,
    activeBuddyUsers,
    totalBusinesses,
    redPinBusinesses,
    pendingBusinesses,
    totalGroups,
    openGroups,
    totalMessages,
    recentMessages,
    sosCount,
    unresolvedSosCount,
    activeOffers,
    totalVisits,
    recentUsers,
    pendingMerchantRows,
    recentGroups,
    recentSafety
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'merchant' }),
    User.countDocuments({ verified: true }),
    User.countDocuments({ buddyMode: true }),
    Business.countDocuments(),
    Business.countDocuments({ 'localVerification.redPin': true }),
    Business.countDocuments({ 'localVerification.status': 'pending' }),
    BuddyGroup.countDocuments(),
    BuddyGroup.countDocuments({ status: { $in: ['open', 'ongoing'] } }),
    ChatMessage.countDocuments(),
    ChatMessage.countDocuments({ createdAt: { $gte: lastDay } }),
    SafetyLog.countDocuments({ type: 'sos' }),
    SafetyLog.countDocuments({ type: 'sos', resolvedAt: { $exists: false } }),
    Offer.countDocuments({ isActive: true, validUntil: { $gt: now } }),
    Visit.countDocuments(),
    User.find().sort({ createdAt: -1 }).limit(8).select('-password').lean(),
    Business.find({ 'localVerification.status': 'pending' }).sort({ updatedAt: -1 }).limit(8).populate('ownerId', 'name email verified').lean(),
    BuddyGroup.find().sort({ createdAt: -1 }).limit(8).populate('creatorId', 'name email').populate('members', 'name email').lean(),
    SafetyLog.find().sort({ createdAt: -1 }).limit(8).populate('userId', 'name email').populate('groupId', 'activity status').lean()
  ]);

  res.json({
    stats: {
      totalUsers,
      explorers: Math.max(0, totalUsers - merchants),
      merchants,
      verifiedUsers,
      activeBuddyUsers,
      totalBusinesses,
      redPinBusinesses,
      pendingBusinesses,
      totalGroups,
      openGroups,
      totalMessages,
      recentMessages,
      sosCount,
      unresolvedSosCount,
      activeOffers,
      totalVisits
    },
    recentUsers: recentUsers.map(cleanUser),
    pendingMerchants: pendingMerchantRows.map(cleanBusiness),
    recentGroups,
    recentSafety
  });
});

router.get('/users', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const role = String(req.query.role || '').trim();
  const query = {};
  if (role === 'explorer' || role === 'merchant') query.role = role;
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: re }, { email: re }];
  }
  const users = await User.find(query).sort({ createdAt: -1 }).limit(80).select('-password').lean();
  res.json({ users: users.map(cleanUser) });
});

router.patch('/users/:id', requireAdmin, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
  const patch = {};
  if (typeof req.body?.verified === 'boolean') patch.verified = req.body.verified;
  if (['explorer', 'merchant'].includes(req.body?.role)) patch.role = req.body.role;
  if (Number.isFinite(Number(req.body?.socialPoints))) patch.socialPoints = Math.max(0, Math.round(Number(req.body.socialPoints)));
  if (Number.isFinite(Number(req.body?.carbonCredits))) patch.carbonCredits = Math.max(0, Math.round(Number(req.body.carbonCredits)));
  const user = await User.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true }).select('-password').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: cleanUser(user) });
});

router.get('/businesses', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const query = {};
  if (['none', 'pending', 'verified'].includes(status)) query['localVerification.status'] = status;
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: re }, { mapDisplayName: re }, { category: re }, { address: re }];
  }
  const businesses = await Business.find(query)
    .sort({ updatedAt: -1 })
    .limit(80)
    .populate('ownerId', 'name email verified role')
    .lean();
  res.json({ businesses: businesses.map(cleanBusiness) });
});

router.patch('/businesses/:id/verification', requireAdmin, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid business id' });
  const status = ['none', 'pending', 'verified'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Valid status is required' });
  const redPin = status === 'verified' ? req.body?.redPin !== false : Boolean(req.body?.redPin);
  const notes = String(req.body?.notes || '').trim().slice(0, 500);
  const business = await Business.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        localVerification: {
          status,
          redPin,
          verifiedAt: status === 'verified' ? new Date() : null,
          notes
        }
      }
    },
    { new: true }
  ).populate('ownerId', 'name email verified role').lean();
  if (!business) return res.status(404).json({ error: 'Business not found' });
  res.json({ business: cleanBusiness(business) });
});

router.get('/groups', requireAdmin, async (req, res) => {
  const status = String(req.query.status || '').trim();
  const query = ['open', 'full', 'ongoing', 'completed'].includes(status) ? { status } : {};
  const groups = await BuddyGroup.find(query)
    .sort({ createdAt: -1 })
    .limit(80)
    .populate('creatorId', 'name email')
    .populate('members', 'name email')
    .lean();
  res.json({ groups });
});

router.patch('/groups/:id', requireAdmin, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid group id' });
  const status = ['open', 'full', 'ongoing', 'completed'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Valid status is required' });
  const group = await BuddyGroup.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true })
    .populate('creatorId', 'name email')
    .populate('members', 'name email')
    .lean();
  if (!group) return res.status(404).json({ error: 'Group not found' });
  res.json({ group });
});

router.get('/offers', requireAdmin, async (_req, res) => {
  const offers = await Offer.find()
    .sort({ createdAt: -1 })
    .limit(80)
    .populate('businessId', 'name category localVerification')
    .lean();
  res.json({ offers });
});

router.patch('/offers/:id', requireAdmin, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid offer id' });
  const patch = {};
  if (typeof req.body?.isActive === 'boolean') patch.isActive = req.body.isActive;
  const offer = await Offer.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true })
    .populate('businessId', 'name category localVerification')
    .lean();
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  res.json({ offer });
});

router.get('/safety', requireAdmin, async (_req, res) => {
  const safetyLogs = await SafetyLog.find()
    .sort({ createdAt: -1 })
    .limit(80)
    .populate('userId', 'name email')
    .populate('groupId', 'activity status')
    .lean();
  res.json({ safetyLogs });
});

router.patch('/safety/:id', requireAdmin, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid safety log id' });
  const resolved = req.body?.resolved !== false;
  const safetyLog = await SafetyLog.findByIdAndUpdate(
    req.params.id,
    { $set: { resolvedAt: resolved ? new Date() : null } },
    { new: true }
  ).populate('userId', 'name email').populate('groupId', 'activity status').lean();
  if (!safetyLog) return res.status(404).json({ error: 'Safety log not found' });
  res.json({ safetyLog });
});

router.get('/messages', requireAdmin, async (_req, res) => {
  const messages = await ChatMessage.find()
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('groupId', 'activity status')
    .populate('userId', 'name email')
    .lean();
  res.json({ messages });
});

export default router;
