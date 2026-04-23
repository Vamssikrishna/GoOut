import express from 'express';
import Visit from '../models/Visit.js';
import Business from '../models/Business.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { sendMerchantFeedbackEmail } from '../utils/email.js';
import {
  createGeminiClient,
  getGenerativeModelForModelId,
  DEFAULT_GEMINI_MODEL,
  buildGeminiCandidateModels,
  GEMINI_KEY_SCOPES
} from '../config/geminiConfig.js';

const router = express.Router();
const VISIT_RADIUS_M = 30;
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MAX_SPEED_KMH = 10;
const CHECK_INTERVAL_SEC = 45;
const MAX_VISIT_GPS_ACCURACY_M = 45;
const BIKE_CO2_G_PER_KM = 72;
const FEEDBACK_FOUL_PATTERNS = [
  /\b(fuck|fucking|fucker|motherfucker)\b/i,
  /\b(shit|bullshit|bitch|bastard|asshole|dickhead)\b/i,
  /\b(chutiya|chu\*+tiya|bc|bhenchod|behenchod|mc|madarchod|gaand[u]?|harami)\b/i,
  /\b(randi|saala|kutta|kamina)\b/i,
  /(fuck|shit|bitch|asshole|bastard){2,}/i
];

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

function computeEcoImpact(distanceMeters, weight, { strongGreen = false, comparatorGuided = false } = {}) {
  const dw = Math.max(0, Number(distanceMeters) || 0);
  const km = dw / 1000;
  const bonus = strongGreen ? 1.25 : 1;
  const carCO2SavedGrams = Math.round(km * CAR_CO2_G_PER_KM * bonus);
  const bikeCO2SavedGrams = Math.round(km * BIKE_CO2_G_PER_KM * bonus);
  const caloriesBurned = Math.round(km * 0.75 * (Number(weight) || 65));
  let carbonCreditsEarned = Math.round(km * 12) / 10;
  if (strongGreen) carbonCreditsEarned += 2;
  if (comparatorGuided) carbonCreditsEarned += 1;
  return {
    distanceWalked: Math.round(dw),
    carCO2SavedGrams: Math.max(0, carCO2SavedGrams),
    bikeCO2SavedGrams: Math.max(0, bikeCO2SavedGrams),
    caloriesBurned: Math.max(0, caloriesBurned),
    carbonCreditsEarned: Math.max(0, Math.round(carbonCreditsEarned * 10) / 10)
  };
}

function containsFoulLanguage(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return FEEDBACK_FOUL_PATTERNS.some((re) => re.test(raw));
}

async function containsFoulLanguageAi(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const genAI = createGeminiClient(GEMINI_KEY_SCOPES.COMPARE_GREEN);
  if (!genAI) return containsFoulLanguage(raw);
  const prompt = `Classify this user feedback as profanity or clean across any language.
Return JSON only: {"isFoul": boolean}
Feedback: ${raw}`;
  const candidates = buildGeminiCandidateModels(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
  for (const modelId of candidates) {
    try {
      const model = getGenerativeModelForModelId(genAI, modelId, {
        generationConfig: { temperature: 0, maxOutputTokens: 120, responseMimeType: 'application/json' }
      });
      if (!model) continue;
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      const textOut = String(result?.response?.text?.() || '').trim();
      const parsed = JSON.parse(textOut);
      if (parsed?.isFoul === true) return true;
      if (parsed?.isFoul === false) return false;
    } catch {
      // try next model
    }
  }
  return containsFoulLanguage(raw);
}

router.post('/impact-preview', protect, async (req, res) => {
  try {
    const { distanceWalked, businessId, fromComparator } = req.body || {};
    const distance = Math.max(0, Number(distanceWalked) || 0);
    let strongGreen = false;
    if (businessId) {
      const business = await Business.findById(businessId).select('greenInitiatives ecoOptions');
      strongGreen = businessEcoStrength(business) >= 4;
    }
    const user = await User.findById(req.user._id).select('weight');
    const impact = computeEcoImpact(distance, user?.weight || 65, {
      strongGreen,
      comparatorGuided: Boolean(fromComparator && businessId)
    });
    res.json(impact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/record', protect, async (req, res) => {
  try {
    const { lat, lng, businessId, publicPlace, accuracy, distanceWalked, timeSinceLastSec, fromComparator, ecoComparisonSaved } = req.body;
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

    const u = await User.findById(req.user._id).select('weight');
    const strongGreen = businessEcoStrength(business) >= 4;
    const eco = computeEcoImpact(dw, u?.weight || 65, {
      strongGreen,
      comparatorGuided: Boolean(visit.comparatorGuided)
    });
    visit.carCO2SavedGrams = eco.carCO2SavedGrams;
    visit.bikeCO2SavedGrams = eco.bikeCO2SavedGrams;
    visit.caloriesBurned = eco.caloriesBurned;
    visit.carbonCreditsEarned = eco.carbonCreditsEarned;
    visit.ecoComparisonSaved = Boolean(ecoComparisonSaved);

    if (visit.ecoComparisonSaved) {
      const inc = {
        'greenStats.totalCO2Saved': eco.carCO2SavedGrams,
        'greenStats.totalCaloriesBurned': eco.caloriesBurned,
        'greenStats.totalWalks': 1,
        carbonCredits: eco.carbonCreditsEarned
      };
      if (visit.comparatorGuided && business?.localVerification?.redPin) {
        inc.socialPoints = 2;
      }
      await User.findByIdAndUpdate(req.user._id, { $inc: inc });
      if (visit.comparatorGuided) {
        visit.comparatorCreditsAwarded = true;
      }
    }
    await visit.save();

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
    const safeNote = String(note || '').trim().slice(0, 500);
    if (await containsFoulLanguageAi(safeNote)) {
      return res.status(400).json({ error: 'No foul language please' });
    }
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
    visit.postBenefitNote = safeNote;
    await visit.save();
    const populated = await Visit.findById(visit._id).populate('businessId', 'name category avgPrice address contactEmail ownerId');
    const feedbackBusiness = await Business.findById(businessId).select('name contactEmail ownerId');
    let merchantEmail = String(feedbackBusiness?.contactEmail || '').trim().toLowerCase();
    if (!merchantEmail && feedbackBusiness?.ownerId) {
      const owner = await User.findById(feedbackBusiness.ownerId).select('email');
      merchantEmail = String(owner?.email || '').trim().toLowerCase();
    }
    if (merchantEmail) {
      const businessName = feedbackBusiness?.name || populated?.businessId?.name || 'your business';
      await sendMerchantFeedbackEmail({
        to: merchantEmail,
        businessName,
        matched: Boolean(matched),
        note: safeNote,
        userName: req.user?.name || 'Explorer',
        userEmail: req.user?.email || 'unknown',
        replyTo: req.user?.email || '',
      });
    }
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
    const totalSavedDelivery = localVisits.reduce((s, v) => {
      const explicit = Number(v.savedVsDeliveryInr);
      if (Number.isFinite(explicit) && explicit > 0) return s + explicit;
      const price = Number(v.businessId?.avgPrice || 0);
      const delivery = price + 40 + 25 + Math.round(price * 0.1);
      return s + Math.max(0, delivery - price);
    }, 0);
    const totalSavedBasicRestaurant = localVisits.reduce((s, v) => s + Math.max(0, Number(v.savedVsBasicRestaurantInr || 0)), 0);
    const totalSavedHighClassRestaurant = localVisits.reduce((s, v) => s + Math.max(0, Number(v.savedVsHighClassRestaurantInr || 0)), 0);
    const user = await User.findById(req.user._id).select('weight');
    const weight = user?.weight || 65;
    const savedOnly = visits.filter((v) => v.ecoComparisonSaved);
    const totalDistance = savedOnly.reduce((s, v) => s + (v.distanceWalked || 0), 0);
    const caloriesBurned = savedOnly.reduce((s, v) => s + Math.max(0, Number(v.caloriesBurned || 0)), 0) || Math.round(totalDistance / 1000 * 0.75 * weight);
    const co2Saved = Math.round((savedOnly.reduce((s, v) => s + Math.max(0, Number(v.carCO2SavedGrams || 0)), 0) / 1000) * 100) / 100;
    const bikeCo2Saved = Math.round((savedOnly.reduce((s, v) => s + Math.max(0, Number(v.bikeCO2SavedGrams || 0)), 0) / 1000) * 100) / 100;
    const totalCarbonCreditsEarned = Math.round(savedOnly.reduce((s, v) => s + Math.max(0, Number(v.carbonCreditsEarned || 0)), 0) * 10) / 10;
    res.json({
      totalVisits: visits.length,
      localVisits: localVisits.length,
      publicVisits: publicVisits.length,
      savedEcoComparisons: savedOnly.length,
      totalSaved: Math.round(totalSavedDelivery),
      totalSavedDelivery: Math.round(totalSavedDelivery),
      totalSavedBasicRestaurant: Math.round(totalSavedBasicRestaurant),
      totalSavedHighClassRestaurant: Math.round(totalSavedHighClassRestaurant),
      totalDistance,
      caloriesBurned,
      co2Saved,
      bikeCo2Saved,
      totalCarbonCreditsEarned
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;