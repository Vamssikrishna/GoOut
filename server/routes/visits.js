import express from 'express';
import Visit from '../models/Visit.js';
import Business from '../models/Business.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
const VISIT_RADIUS_M = 5;
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MAX_SPEED_KMH = 10;
const CHECK_INTERVAL_SEC = 45;

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

router.post('/record', protect, async (req, res) => {
  try {
    const { lat, lng, businessId, distanceWalked, timeSinceLastSec } = req.body;
    if (!lat || !lng || !businessId) return res.status(400).json({ error: 'lat, lng, businessId required' });
    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const dist = getDistance(lat, lng, business.location.coordinates[1], business.location.coordinates[0]);
    if (dist > VISIT_RADIUS_M) return res.status(400).json({ error: 'Not close enough to business' });
    const recent = await Visit.findOne({
      userId: req.user._id,
      businessId,
      visitedAt: { $gte: new Date(Date.now() - COOLDOWN_MS) }
    });
    if (recent) return res.json({ message: 'Visit already recorded', visit: recent });
    const timeSec = timeSinceLastSec || CHECK_INTERVAL_SEC;
    const dw = typeof distanceWalked === 'number' && distanceWalked > 0 ? distanceWalked : Math.round(dist);
    const speedKmh = timeSec > 0 ? (dw / 1000) / (timeSec / 3600) : 0;
    if (speedKmh > MAX_SPEED_KMH) return res.status(400).json({ error: 'Velocity check failed - too fast to be walking' });
    const visit = await Visit.create({
      userId: req.user._id,
      businessId,
      userCoords: { type: 'Point', coordinates: [lng, lat] },
      distanceWalked: dw
    });
    const populated = await Visit.findById(visit._id).populate('businessId', 'name category avgPrice address');
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', protect, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const visits = await Visit.find({ userId: req.user._id })
      .sort({ visitedAt: -1 })
      .limit(Number(limit))
      .populate('businessId', 'name category avgPrice address location');
    res.json(visits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', protect, async (req, res) => {
  try {
    const visits = await Visit.find({ userId: req.user._id }).populate('businessId', 'avgPrice');
    const totalSaved = visits.reduce((s, v) => {
      const price = v.businessId?.avgPrice || 0;
      const delivery = price + 40 + 25 + Math.round(price * 0.1);
      return s + (delivery - price);
    }, 0);
    const user = await User.findById(req.user._id).select('weight');
    const weight = user?.weight || 65;
    const totalDistance = visits.reduce((s, v) => s + (v.distanceWalked || 0), 0);
    const caloriesBurned = Math.round(totalDistance / 1000 * 0.75 * weight);
    const co2Saved = Math.round(totalDistance / 1000 * 0.1 * 100) / 100;
    res.json({ totalVisits: visits.length, totalSaved, totalDistance, caloriesBurned, co2Saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
