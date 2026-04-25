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

function progressPct(current, target) {
  const c = Math.max(0, Number(current) || 0);
  const t = Math.max(1, Number(target) || 1);
  return Math.min(100, Math.round(c / t * 100));
}

function computeVisitStreakDays(visits = []) {
  const dayKeys = [...new Set(
    (visits || [])
      .map((v) => new Date(v.visitedAt || v.createdAt || Date.now()).toISOString().slice(0, 10))
      .filter(Boolean)
  )].sort();
  if (!dayKeys.length) return 0;
  let streak = 1;
  for (let i = dayKeys.length - 1; i > 0; i -= 1) {
    const curr = new Date(`${dayKeys[i]}T00:00:00Z`).getTime();
    const prev = new Date(`${dayKeys[i - 1]}T00:00:00Z`).getTime();
    const diffDays = Math.round((curr - prev) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) streak += 1;
    else break;
  }
  return streak;
}

function computeBadges({ totalDistanceM, localVisitsWithGreen, totalCo2SavedGrams, carbonCredits, totalCalories, streakDays }) {
  const km = (Number(totalDistanceM) || 0) / 1000;
  const credits = Number(carbonCredits || 0);
  const co2g = Number(totalCo2SavedGrams || 0);
  const kcal = Number(totalCalories || 0);
  const streak = Number(streakDays || 0);
  return [
    {
      id: 'walk_10km',
      label: 'Trail Blazer · 10 km walked',
      earned: km >= 10,
      progress: progressPct(km, 10)
    },
    {
      id: 'green_shops_5',
      label: 'Local Green Hero · 5 eco local visits',
      earned: Number(localVisitsWithGreen || 0) >= 5,
      progress: progressPct(localVisitsWithGreen, 5)
    },
    {
      id: 'co2_5kg',
      label: 'CO2 Saver · 5 kg avoided',
      earned: co2g >= 5000,
      progress: progressPct(co2g, 5000)
    },
    {
      id: 'credits_50',
      label: 'Carbon Wallet · 50 credits',
      earned: credits >= 50,
      progress: progressPct(credits, 50)
    },
    {
      id: 'burn_1500',
      label: 'Active Explorer · 1500 kcal burned',
      earned: kcal >= 1500,
      progress: progressPct(kcal, 1500)
    },
    {
      id: 'streak_7',
      label: 'Consistency Streak · 7 days',
      earned: streak >= 7,
      progress: progressPct(streak, 7)
    }
  ];
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
    const savedOnly = visits.filter((v) => v.ecoComparisonSaved);
    const totalDistance = savedOnly.reduce((s, v) => s + Math.max(0, Number(v.distanceWalked || 0)), 0);
    const weight = user?.weight || 65;
    const caloriesBurned =
      Math.round(savedOnly.reduce((s, v) => s + Math.max(0, Number(v.caloriesBurned || 0)), 0)) ||
      Math.round(totalDistance / 1000 * 0.75 * weight);
    const totalCo2SavedGrams = Math.round(savedOnly.reduce((s, v) => s + Math.max(0, Number(v.carCO2SavedGrams || 0)), 0));
    const totalBikeCo2SavedGrams = Math.round(savedOnly.reduce((s, v) => s + Math.max(0, Number(v.bikeCO2SavedGrams || 0)), 0));
    const totalCarbonCreditsEarned = Math.round(savedOnly.reduce((s, v) => s + Math.max(0, Number(v.carbonCreditsEarned || 0)), 0) * 10) / 10;
    const localGreenVisits = localVisits.filter((v) => businessEcoStrengthFromVisit(v.businessId) >= 4).length;
    const streakDays = computeVisitStreakDays(savedOnly);

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
      totalCo2SavedGrams,
      carbonCredits: user?.carbonCredits || totalCarbonCreditsEarned,
      totalCalories: caloriesBurned,
      streakDays
    });

    res.json({
      profile: {
        greenStats: user?.greenStats || {},
        carbonCredits: Math.max(Number(user?.carbonCredits || 0), totalCarbonCreditsEarned),
        weight
      },
      visitRollup: {
        totalVisits: savedOnly.length,
        localVisits: localVisits.length,
        totalDistanceMeters: totalDistance,
        caloriesBurned,
        co2SavedGrams: totalCo2SavedGrams,
        bikeCo2SavedGrams: totalBikeCo2SavedGrams,
        carbonCreditsEarned: totalCarbonCreditsEarned,
        streakDays
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
