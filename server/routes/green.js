import express from 'express';
import User from '../models/User.js';
import Visit from '../models/Visit.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

function businessEcoStrengthFromVisit(b) {
  if (!b) return 0;
  let n = (b.greenInitiatives || []).length;
  const eco = b.ecoOptions || {};
  if (eco.plasticFree) n += 2;
  if (eco.solarPowered) n += 2;
  if (eco.zeroWaste) n += 2;
  return n;
}

function computeBadges({ totalDistanceM, localVisitsWithGreen, greenStats, carbonCredits }) {
  const badges = [];
  const km = (Number(totalDistanceM) || 0) / 1000;
  if (km >= 10) badges.push({ id: 'walk_10km', label: '10 km walked', earned: true });
  else badges.push({ id: 'walk_10km', label: '10 km walked', earned: false, progress: Math.min(100, Math.round((km / 10) * 100)) });

  if (localVisitsWithGreen >= 5) badges.push({ id: 'green_shops_5', label: '5 green local shops', earned: true });
  else badges.push({ id: 'green_shops_5', label: '5 green local shops', earned: false, progress: Math.min(100, Math.round((localVisitsWithGreen / 5) * 100)) });

  const co2g = Number(greenStats?.totalCO2Saved || 0);
  if (co2g >= 5000) badges.push({ id: 'co2_5kg', label: '5 kg CO₂ avoided (cumulative)', earned: true });
  else badges.push({ id: 'co2_5kg', label: '5 kg CO₂ avoided (cumulative)', earned: false, progress: Math.min(100, Math.round((co2g / 5000) * 100)) });

  if (Number(carbonCredits || 0) >= 50) badges.push({ id: 'credits_50', label: '50+ carbon credits', earned: true });

  return badges;
}

/** Nearby explorers ranked by green activity (requires stored user locations). */
router.get('/leaderboard', protect, async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const limit = Math.min(30, Math.max(5, Number(req.query.limit) || 15));
    const maxM = 25000;

    const scoreUser = (u) =>
      Number(u.carbonCredits || 0) * 80 + Number(u.greenStats?.totalCO2Saved || 0) + Number(u.greenStats?.totalWalks || 0) * 20;

    let query = User.find({ role: 'explorer' }).
      select('name avatar greenStats carbonCredits location').
      limit(400).
      lean();

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      query = User.find({
        role: 'explorer',
        location: {
          $nearSphere: {
            $geometry: { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: maxM
          }
        }
      }).
        select('name avatar greenStats carbonCredits location').
        limit(200).
        lean();
    }

    let users = await query;
    if (!users.length) {
      users = await User.find({ role: 'explorer' }).
        select('name avatar greenStats carbonCredits location').
        limit(200).
        lean();
    }

    const ranked = users
      .filter((u) => String(u._id) !== String(req.user._id))
      .map((u) => ({
        id: u._id,
        name: u.name,
        avatar: u.avatar,
        score: scoreUser(u),
        co2SavedGrams: u.greenStats?.totalCO2Saved || 0,
        walks: u.greenStats?.totalWalks || 0
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const me = await User.findById(req.user._id).select('name greenStats carbonCredits').lean();
    const myRank = {
      name: me?.name,
      score: scoreUser(me || {}),
      co2SavedGrams: me?.greenStats?.totalCO2Saved || 0
    };

    res.json({ nearbyKm: Number.isFinite(lat) && Number.isFinite(lng) ? maxM / 1000 : null, leaderboard: ranked, you: myRank });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/community', protect, async (req, res) => {
  try {
    const [agg] = await User.aggregate([
      {
        $group: {
          _id: null,
          totalCo2Grams: { $sum: { $ifNull: ['$greenStats.totalCO2Saved', 0] } },
          totalWalks: { $sum: { $ifNull: ['$greenStats.totalWalks', 0] } },
          explorers: { $sum: 1 }
        }
      }
    ]);
    res.json({
      totalCo2Grams: agg?.totalCo2Grams || 0,
      totalCo2Kg: Math.round(((agg?.totalCo2Grams || 0) / 1000) * 10) / 10,
      totalWalks: agg?.totalWalks || 0,
      explorerCount: agg?.explorers || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/dashboard', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('weight greenStats carbonCredits').lean();
    const visits = await Visit.find({ userId: req.user._id }).
      populate('businessId', 'greenInitiatives ecoOptions').
      lean();
    const localVisits = visits.filter((v) => v.placeType !== 'public' && v.businessId);
    const totalDistance = visits.reduce((s, v) => s + (v.distanceWalked || 0), 0);
    const weight = user?.weight || 65;
    const caloriesBurned = Math.round(totalDistance / 1000 * 0.75 * weight);
    const localGreenVisits = localVisits.filter((v) => businessEcoStrengthFromVisit(v.businessId) >= 4).length;

    const [community] = await Promise.all([
      User.aggregate([
        {
          $group: {
            _id: null,
            totalCo2Grams: { $sum: { $ifNull: ['$greenStats.totalCO2Saved', 0] } },
            totalWalks: { $sum: { $ifNull: ['$greenStats.totalWalks', 0] } },
            explorers: { $sum: 1 }
          }
        }
      ])
    ]);

    const agg = community?.[0];
    const badges = computeBadges({
      totalDistanceM: totalDistance,
      localVisitsWithGreen: localGreenVisits,
      greenStats: user?.greenStats,
      carbonCredits: user?.carbonCredits
    });

    res.json({
      profile: {
        greenStats: user?.greenStats || {},
        carbonCredits: user?.carbonCredits || 0,
        weight
      },
      visitRollup: {
        totalVisits: visits.length,
        localVisits: localVisits.length,
        totalDistanceMeters: totalDistance,
        caloriesBurned,
        co2WalkProxyKg: Math.round(totalDistance / 1000 * 0.1 * 100) / 100
      },
      badges,
      community: {
        totalCo2Grams: agg?.totalCo2Grams || 0,
        totalCo2Kg: Math.round(((agg?.totalCo2Grams || 0) / 1000) * 10) / 10,
        totalWalks: agg?.totalWalks || 0,
        explorerCount: agg?.explorers || 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
