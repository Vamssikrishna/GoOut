import express from 'express';
import Business from '../models/Business.js';
import User from '../models/User.js';
import Offer from '../models/Offer.js';
import Visit from '../models/Visit.js';
import CrowdDispute from '../models/CrowdDispute.js';
import { protect, merchantOnly, optionalProtect } from '../middleware/auth.js';
import AnalyticsHit from '../models/AnalyticsHit.js';
import DailyStats from '../models/DailyStats.js';

const router = express.Router();
const RED_PIN_PRIORITY_MULTIPLIER = 1.35;

function applyLocalPrioritySorting(items) {
  return [...items].sort((a, b) => {
    const aRed = a?.localVerification?.redPin ? 1 : 0;
    const bRed = b?.localVerification?.redPin ? 1 : 0;
    if (aRed !== bRed) return bRed - aRed;
    const aKarma = Number(a?.localKarmaScore || 0);
    const bKarma = Number(b?.localKarmaScore || 0);
    if (aKarma !== bKarma) return bKarma - aKarma;
    return 0;
  });
}

// Expects user's (lng, lat). Optional category or q (semantic search on category + tags). Returns sorted by distance.
router.get('/nearby', async (req, res) => {
  try {
    const { lng, lat, maxDistance: maxDistanceParam, category, q } = req.query;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const defaultMax = (category || q) ? 50000 : 5000;
    const maxDistance = Number(maxDistanceParam) || defaultMax;
    let query = {
      location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: maxDistance } }
    };
    if (category) {
      const c = new RegExp(category.trim(), 'i');
      // Treat category search as a general text query for merchants too (name/tags/category)
      query.$or = [
        { category: c },
        { name: c },
        { tags: c },
      ];
    }
    if (q && q.trim()) {
      const r = new RegExp(q.trim().replace(/\s+/g, '|'), 'i');
      query.$or = [
        { category: r },
        { name: r },
        { tags: r }
      ];
    }
    const businesses = await Business.find(query).limit(100).populate('ownerId', 'name verified');
    res.json(applyLocalPrioritySorting(businesses));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recommend', async (req, res) => {
  try {
    const { lng, lat, budget, weightRating = 0.4, weightPrice = 0.3, weightDistance = 0.3 } = req.query;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const maxBudget = parseFloat(budget) || 1000;
    const businesses = await Business.find({
      location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: 10000 } },
      avgPrice: { $lte: maxBudget }
    }).limit(100).populate('ownerId', 'name verified');

    const wr = parseFloat(weightRating) || 0.4;
    const wp = parseFloat(weightPrice) || 0.3;
    const wd = parseFloat(weightDistance) || 0.3;

    const now = Date.now();
    const BOOST_DAYS = 30;
    const scored = businesses.map(b => {
      const ratingScore = (b.rating || 0) / 5;
      const priceScore = 1 - Math.min((b.avgPrice || 0) / Math.max(maxBudget, 1), 1);
      const dist = getDistance(coords[1], coords[0], b.location.coordinates[1], b.location.coordinates[0]);
      const distanceScore = Math.max(0, 1 - dist / 5000);
      let score = wr * ratingScore + wp * priceScore + wd * distanceScore;
      if (b.localVerification?.redPin) score *= RED_PIN_PRIORITY_MULTIPLIER;
      score += Math.min(0.12, Number(b.localKarmaScore || 0) * 0.005);
      if ((b.ratingCount || 0) < 5 && b.createdAt && (now - new Date(b.createdAt)) < BOOST_DAYS * 86400000) {
        score += 0.2;
      }
      return { ...b.toObject(), score, distance: dist };
    });
    scored.sort((a, b) => b.score - a.score);
    res.json(scored.slice(0, 50));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const DEBOUNCE_VIEW_MS = 24 * 60 * 60 * 1000;

router.get('/:id', optionalProtect, async (req, res) => {
  try {
    const business = await Business.findById(req.params.id)
      .populate('ownerId', 'name verified');
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const visitorKey = req.user?._id?.toString() || `ip-${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const since = new Date(Date.now() - DEBOUNCE_VIEW_MS);
    const recent = await AnalyticsHit.findOne({ businessId: business._id, visitorKey, type: 'view', at: { $gte: since } });
    if (!recent) {
      business.analytics.profileViews = (business.analytics.profileViews || 0) + 1;
      const hour = new Date().getHours();
      const peak = business.analytics.peakHours || new Map();
      peak.set(String(hour), (peak.get(String(hour)) || 0) + 1);
      business.analytics.peakHours = peak;
      await business.save();
      const today = new Date().toISOString().slice(0, 10);
      await DailyStats.findOneAndUpdate(
        { businessId: business._id, date: today },
        { $inc: { profileViews: 1 } },
        { upsert: true }
      );
      await AnalyticsHit.create({ businessId: business._id, visitorKey, type: 'view' });
    }
    res.json(business);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', protect, merchantOnly, async (req, res) => {
  try {
    const { name, description, category, tags, lat, lng, address, phone, avgPrice, isFree, openingHours, menu, greenInitiatives } = req.body;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const hours = openingHours && typeof openingHours === 'object' && !Array.isArray(openingHours)
      ? openingHours
      : (openingHours ? { default: String(openingHours) } : {});
    const business = await Business.create({
      ownerId: req.user._id,
      name,
      description,
      category,
      tags: tags || [],
      location: { type: 'Point', coordinates: coords },
      address,
      phone,
      avgPrice: avgPrice || 0,
      isFree: isFree || false,
      openingHours: hours,
      menu: Array.isArray(menu) ? menu : [],
      greenInitiatives: Array.isArray(greenInitiatives) ? greenInitiatives : [],
      localKarmaScore: Array.isArray(greenInitiatives) ? Math.min(100, greenInitiatives.length * 10) : 0,
    });
    await User.findByIdAndUpdate(req.user._id, { businessId: business._id });
    res.status(201).json(business);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CROWD_DECAY_MS = 3 * 60 * 60 * 1000;

router.put('/:id', protect, async (req, res) => {
  try {
    const business = await Business.findById(req.params.id);
    if (!business || business.ownerId.toString() !== req.user._id.toString())
      return res.status(403).json({ error: 'Not authorized' });
    const { name, description, category, tags, lat, lng, address, phone, avgPrice, crowdLevel, isFree, menu, greenInitiatives } = req.body;
    if (name) business.name = name;
    if (description !== undefined) business.description = description;
    if (category) business.category = category;
    if (tags) business.tags = tags;
    if (lat != null && lng != null) business.location.coordinates = [parseFloat(lng), parseFloat(lat)];
    if (address) business.address = address;
    if (phone !== undefined) business.phone = phone;
    if (avgPrice !== undefined) business.avgPrice = avgPrice;
    if (isFree !== undefined) business.isFree = isFree;
    if (menu !== undefined) business.menu = Array.isArray(menu) ? menu : [];
    if (greenInitiatives !== undefined) {
      business.greenInitiatives = Array.isArray(greenInitiatives) ? greenInitiatives : [];
      business.localKarmaScore = Math.min(100, business.greenInitiatives.length * 10);
    }
    if (crowdLevel !== undefined) {
      business.crowdLevel = Math.min(100, Math.max(0, crowdLevel));
      business.crowdLastPing = new Date();
    }
    if (business.crowdLastPing && Date.now() - business.crowdLastPing > CROWD_DECAY_MS) {
      business.crowdLevel = 50;
    }
    await business.save();
    const io = req.app.get('io');
    if (io) io.emit('crowd-changed', { businessId: business._id, level: business.crowdLevel });
    res.json(business);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/verify-local', protect, merchantOnly, async (req, res) => {
  try {
    const business = await Business.findById(req.params.id);
    if (!business || business.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const hasCoordinates = Array.isArray(business.location?.coordinates) && business.location.coordinates.length === 2;
    const hasAddress = Boolean(String(business.address || '').trim());
    if (!hasCoordinates || !hasAddress) {
      return res.status(400).json({ error: 'Business must have a valid address and GPS coordinates before local verification.' });
    }

    const canAutoVerify = Boolean(req.user.verified);
    business.localVerification = {
      ...(business.localVerification || {}),
      status: canAutoVerify ? 'verified' : 'pending',
      redPin: canAutoVerify,
      verifiedAt: canAutoVerify ? new Date() : null,
      notes: canAutoVerify ? 'Auto-verified via trusted merchant account.' : 'Verification request received. Pending review.',
    };
    await business.save();
    res.json({
      ok: true,
      localVerification: business.localVerification,
      message: canAutoVerify
        ? 'Local-first verification completed. Red pin activated.'
        : 'Verification request submitted and pending review.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', protect, merchantOnly, async (req, res) => {
  try {
    const business = await Business.findById(req.params.id);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    if (business.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await Promise.all([
      Offer.deleteMany({ businessId: business._id }),
      Visit.deleteMany({ businessId: business._id }),
      CrowdDispute.deleteMany({ businessId: business._id }),
      AnalyticsHit.deleteMany({ businessId: business._id }),
      DailyStats.deleteMany({ businessId: business._id }),
      Business.deleteOne({ _id: business._id }),
    ]);

    await User.updateOne(
      { _id: req.user._id, businessId: business._id },
      { $unset: { businessId: 1 } }
    );

    res.json({ message: 'Business deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explorer reports "Actually, it's busy/quiet here". If 3+ reports for business, force-update crowd level.
const CROWD_DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000;
const CROWD_DISPUTE_THRESHOLD = 3;

router.post('/:id/crowd-report', protect, async (req, res) => {
  try {
    const business = await Business.findById(req.params.id);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const level = Math.min(100, Math.max(0, Number(req.body.level) || 50));
    await CrowdDispute.findOneAndUpdate(
      { businessId: business._id, userId: req.user._id },
      { $set: { level } },
      { upsert: true }
    );
    const since = new Date(Date.now() - CROWD_DISPUTE_WINDOW_MS);
    const reports = await CrowdDispute.find({ businessId: business._id, createdAt: { $gte: since } });
    if (reports.length >= CROWD_DISPUTE_THRESHOLD) {
      const levels = reports.map((r) => r.level).sort((a, b) => a - b);
      const median = levels[Math.floor(levels.length / 2)];
      business.crowdLevel = median;
      business.crowdLastPing = new Date();
      await business.save();
      await CrowdDispute.deleteMany({ businessId: business._id });
      const io = req.app.get('io');
      if (io) io.emit('crowd-changed', { businessId: business._id, level: median });
    }
    res.json({ ok: true, reports: reports.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/analytics', protect, async (req, res) => {
  try {
    const business = await Business.findById(req.params.id);
    if (!business || business.ownerId.toString() !== req.user._id.toString())
      return res.status(403).json({ error: 'Not authorized' });
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const dailyStats = await DailyStats.find({ businessId: business._id, date: { $in: days } }).sort({ date: 1 });
    const byDate = Object.fromEntries(dailyStats.map((s) => [s.date, { profileViews: s.profileViews || 0, offerClicks: s.offerClicks || 0 }]));
    const daily = days.map((date) => ({ date, ...(byDate[date] || { profileViews: 0, offerClicks: 0 }) }));
    const peakHours = business.analytics?.peakHours instanceof Map
      ? Object.fromEntries(business.analytics.peakHours)
      : (business.analytics?.peakHours || {});
    res.json({
      profileViews: business.analytics?.profileViews || 0,
      offerClicks: business.analytics?.offerClicks || 0,
      peakHours,
      daily,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
