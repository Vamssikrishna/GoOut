import express from 'express';
import Visit from '../models/Visit.js';
import Business from '../models/Business.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
const VISIT_RADIUS_M = 30;
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MAX_SPEED_KMH = 10;
const CHECK_INTERVAL_SEC = 45;
const MAX_VISIT_GPS_ACCURACY_M = 45;

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const CAR_CO2_G_PER_KM = 192;

function businessEcoStrength(b) {
  if (!b) return 0;
  let n = (b.greenInitiatives || []).length;
  const eco = b.ecoOptions || {};
  if (eco.plasticFree) n += 2;
  if (eco.solarPowered) n += 2;
  if (eco.zeroWaste) n += 2;
  return n;
}

router.post('/record', protect, async (req, res) => {
  try {
    const { lat, lng, businessId, publicPlace, accuracy, distanceWalked, timeSinceLastSec, fromComparator } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng are required' });
    if (Number.isFinite(Number(accuracy)) && Number(accuracy) > MAX_VISIT_GPS_ACCURACY_M) {
      return res.status(400).json({ error: 'GPS accuracy too low for precise visit logging' });
    }
    if (!businessId && !publicPlace) return res.status(400).json({ error: 'businessId or publicPlace required' });

    let targetLat = null;
    let targetLng = null;
    let placeType = 'local';
    let placeName = '';
    let placeCategory = '';
    let placeKey = '';
    let business = null;

    if (businessId) {
      business = await Business.findById(businessId);
      if (!business) return res.status(404).json({ error: 'Business not found' });
      if (!business.location?.coordinates?.length) return res.status(400).json({ error: 'Business location missing' });
      targetLat = business.location.coordinates[1];
      targetLng = business.location.coordinates[0];
      placeType = 'local';
      placeName = business.name || '';
      placeCategory = business.category || '';
      placeKey = `local:${businessId}`;
    } else {
      const pLat = Number(publicPlace?.lat);
      const pLng = Number(publicPlace?.lng);
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) {
        return res.status(400).json({ error: 'publicPlace lat/lng required' });
      }
      const normalizedName = String(publicPlace?.name || 'Public place').trim();
      placeType = 'public';
      placeName = normalizedName || 'Public place';
      placeCategory = String(publicPlace?.category || 'public').trim();
      targetLat = pLat;
      targetLng = pLng;
      placeKey = `public:${placeName.toLowerCase()}:${pLat.toFixed(5)}:${pLng.toFixed(5)}`;
    }

    const dist = getDistance(lat, lng, targetLat, targetLng);
    if (dist > VISIT_RADIUS_M) return res.status(400).json({ error: 'Not close enough to visited place' });
    const recent = await Visit.findOne({
      userId: req.user._id,
      placeKey,
      visitedAt: { $gte: new Date(Date.now() - COOLDOWN_MS) }
    });
    if (recent) return res.json({ message: 'Visit already recorded', visit: recent });
    const timeSec = timeSinceLastSec || CHECK_INTERVAL_SEC;
    const dw = typeof distanceWalked === 'number' && distanceWalked > 0 ? distanceWalked : Math.round(dist);
    const speedKmh = timeSec > 0 ? dw / 1000 / (timeSec / 3600) : 0;
    if (speedKmh > MAX_SPEED_KMH) return res.status(400).json({ error: 'Velocity check failed - too fast to be walking' });
    const visit = await Visit.create({
      userId: req.user._id,
      placeType,
      placeKey,
      businessId: businessId || undefined,
      placeName,
      placeCategory,
      placeCoords: { type: 'Point', coordinates: [targetLng, targetLat] },
      userCoords: { type: 'Point', coordinates: [lng, lat] },
      distanceWalked: dw,
      comparatorGuided: Boolean(fromComparator && businessId)
    });

    if (business) {
      const u = await User.findById(req.user._id).select('weight');
      const weight = u?.weight || 65;
      const km = dw / 1000;
      const strongGreen = businessEcoStrength(business) >= 4;
      const bonus = strongGreen ? 1.25 : 1;
      const gramsAvoided = Math.round(km * CAR_CO2_G_PER_KM * bonus);
      const cal = Math.round(km * 0.75 * weight);
      let carbonCredits = Math.round(km * 12) / 10;
      if (strongGreen) carbonCredits += 2;
      if (visit.comparatorGuided) carbonCredits += 1;

      const inc = {
        'greenStats.totalCO2Saved': gramsAvoided,
        'greenStats.totalCaloriesBurned': cal,
        'greenStats.totalWalks': 1,
        carbonCredits: Math.max(0, carbonCredits)
      };
      if (visit.comparatorGuided && business?.localVerification?.redPin) {
        inc.socialPoints = 2;
      }

      await User.findByIdAndUpdate(req.user._id, { $inc: inc });
      if (visit.comparatorGuided) {
        visit.comparatorCreditsAwarded = true;
        await visit.save();
      }
    }

    const populated = await Visit.findById(visit._id).populate('businessId', 'name category avgPrice address');
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', protect, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const visits = await Visit.find({ userId: req.user._id }).
    sort({ visitedAt: -1 }).
    limit(Number(limit)).
    populate('businessId', 'name category avgPrice address location');
    res.json(visits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/benefit-feedback', protect, async (req, res) => {
  try {
    const { businessId, matched, note } = req.body;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const visit = await Visit.findOne({
      userId: req.user._id,
      businessId,
      visitedAt: { $gte: since }
    }).sort({ visitedAt: -1 });
    if (!visit) {
      return res.status(404).json({ error: 'No recent visit found for this place' });
    }
    visit.postBenefitMatched = Boolean(matched);
    visit.postBenefitNote = String(note || '').slice(0, 500);
    await visit.save();
    const populated = await Visit.findById(visit._id).populate('businessId', 'name category avgPrice address');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', protect, async (req, res) => {
  try {
    const visits = await Visit.find({ userId: req.user._id }).populate('businessId', 'avgPrice');
    const localVisits = visits.filter((v) => v.placeType !== 'public' && v.businessId);
    const publicVisits = visits.filter((v) => v.placeType === 'public');
    const totalSaved = localVisits.reduce((s, v) => {
      const price = v.businessId?.avgPrice || 0;
      const delivery = price + 40 + 25 + Math.round(price * 0.1);
      return s + (delivery - price);
    }, 0);
    const user = await User.findById(req.user._id).select('weight');
    const weight = user?.weight || 65;
    const totalDistance = visits.reduce((s, v) => s + (v.distanceWalked || 0), 0);
    const caloriesBurned = Math.round(totalDistance / 1000 * 0.75 * weight);
    const co2Saved = Math.round(totalDistance / 1000 * 0.1 * 100) / 100;
    res.json({
      totalVisits: visits.length,
      localVisits: localVisits.length,
      publicVisits: publicVisits.length,
      totalSaved,
      totalDistance,
      caloriesBurned,
      co2Saved
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;