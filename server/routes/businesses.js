import express from 'express';
import Business from '../models/Business.js';
import User from '../models/User.js';
import Offer from '../models/Offer.js';
import Visit from '../models/Visit.js';
import CrowdDispute from '../models/CrowdDispute.js';
import { protect, merchantOnly, optionalProtect } from '../middleware/auth.js';
import AnalyticsHit from '../models/AnalyticsHit.js';
import DailyStats from '../models/DailyStats.js';
import { extractMerchantOnboardingFromSentence } from '../services/merchantOnboardingAi.js';

const router = express.Router();
const RED_PIN_PRIORITY_MULTIPLIER = 1.35;
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const PRICE_TIER_AVG_INR = { 1: 200, 2: 450, 3: 900, 4: 2200 };

function normalizeWeeklySchedule(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of DAY_KEYS) {
    const v = input[k];
    if (!v || typeof v !== 'object') continue;
    out[k] = {
      closed: Boolean(v.closed),
      open: String(v.open || '').trim().slice(0, 8),
      close: String(v.close || '').trim().slice(0, 8)
    };
  }
  return out;
}

function weeklyScheduleToOpeningHoursMap(w) {
  const hours = {};
  for (const k of DAY_KEYS) {
    const v = w[k];
    if (!v) continue;
    if (v.closed) {
      hours[k] = 'Closed';
      continue;
    }
    const o = String(v.open || '').trim();
    const c = String(v.close || '').trim();
    if (o && c) hours[k] = `${o}–${c}`;
    else if (o || c) hours[k] = `${o}${c}`;
    else hours[k] = 'Closed';
  }
  return hours;
}

function plainOpeningHours(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body instanceof Map) return Object.fromEntries(body);
  return { ...body };
}

function mergeOpeningHoursPayload({ weeklySchedule, openingHoursBody }) {
  const wk = normalizeWeeklySchedule(weeklySchedule);
  const fromWeek = weeklyScheduleToOpeningHoursMap(wk);
  if (Object.keys(fromWeek).length) return { hours: fromWeek, weekly: wk };
  const plain = plainOpeningHours(openingHoursBody);
  if (plain) return { hours: plain, weekly: {} };
  const line = String(openingHoursBody || '').trim();
  if (line) return { hours: { default: line }, weekly: {} };
  return { hours: {}, weekly: {} };
}

function ecoInitiativeLabels(eco, carbonWalk) {
  const list = [];
  if (eco?.plasticFree) list.push('Plastic-Free');
  if (eco?.solarPowered) list.push('Solar Powered');
  if (eco?.zeroWaste) list.push('Zero-Waste');
  if (carbonWalk) list.push('Walker-friendly incentives');
  return list;
}

function uniqStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const s = String(x || '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= 24) break;
  }
  return out;
}

function sanitizeVerificationDocs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.
    map((d) => ({
      url: String(d?.url || '').trim(),
      label: String(d?.label || 'document').trim().slice(0, 40)
    })).
    filter((d) => d.url.startsWith('/uploads/')).
    slice(0, 8);
}

function buildAddressLine(structured, fallback) {
  if (!structured || typeof structured !== 'object') return fallback || '';
  const parts = [
    structured.street,
    structured.neighborhood,
    structured.city,
    structured.postalCode
  ].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : (fallback || '');
}

function coercePriceTier(n) {
  const t = Math.round(Number(n));
  if (!Number.isFinite(t) || t < 1) return 2;
  if (t > 4) return 4;
  return t;
}

function pinLine(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return 'Map pin';
  return `Map pin (${la.toFixed(5)}, ${ln.toFixed(5)})`;
}

function escapeRegexChars(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** OR of whitespace-separated tokens; safe for arbitrary user input. */
function buildOrRegexFromQuery(q) {
  const raw = String(q || '').trim();
  if (!raw) return null;
  const tokens = raw.split(/\s+/).map((t) => escapeRegexChars(t)).filter(Boolean);
  if (!tokens.length) return null;
  try {
    return new RegExp(tokens.join('|'), 'i');
  } catch {
    return null;
  }
}

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


router.get('/nearby', async (req, res) => {
  try {
    const { lng, lat, maxDistance: maxDistanceParam, category, q } = req.query;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const defaultMax = category || q ? 50000 : 5000;
    const maxDistance = Number(maxDistanceParam) || defaultMax;
    let query = {
      location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: maxDistance } }
    };
    if (category && String(category).trim()) {
      const escaped = escapeRegexChars(String(category).trim());
      try {
        const c = new RegExp(escaped, 'i');
        query.$or = [{ category: c }, { name: c }, { tags: c }];
      } catch {
        /* ignore invalid pattern */
      }
    }
    if (q && String(q).trim()) {
      const r = buildOrRegexFromQuery(q);
      if (r) {
        query.$or = [{ category: r }, { name: r }, { tags: r }];
      } else {
        return res.json([]);
      }
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
    const scored = businesses.map((b) => {
      const ratingScore = (b.rating || 0) / 5;
      const priceScore = 1 - Math.min((b.avgPrice || 0) / Math.max(maxBudget, 1), 1);
      const dist = getDistance(coords[1], coords[0], b.location.coordinates[1], b.location.coordinates[0]);
      const distanceScore = Math.max(0, 1 - dist / 5000);
      let score = wr * ratingScore + wp * priceScore + wd * distanceScore;
      if (b.localVerification?.redPin) score *= RED_PIN_PRIORITY_MULTIPLIER;
      score += Math.min(0.12, Number(b.localKarmaScore || 0) * 0.005);
      if ((b.ratingCount || 0) < 5 && b.createdAt && now - new Date(b.createdAt) < BOOST_DAYS * 86400000) {
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

/** AI: one-sentence → structured fields (must stay above `GET /:id`). */
router.post('/onboard-ai', protect, merchantOnly, async (req, res) => {
  try {
    const sentence = String(req.body?.sentence || '').trim();
    if (sentence.length < 10) {
      return res.status(400).json({ error: 'Write at least a short sentence describing your business.' });
    }
    if (sentence.length > 2000) {
      return res.status(400).json({ error: 'Description is too long (max 2000 characters).' });
    }
    const data = await extractMerchantOnboardingFromSentence(sentence);
    console.log('[merchant onboard-ai]', {
      userId: req.user?._id?.toString(),
      fromCache: data.fromCache,
      name: data.name,
      category: data.category,
      vibe: data.vibe
    });
    return res.json(data);
  } catch (err) {
    console.error('[merchant onboard-ai] failed', err?.message || err);
    return res.status(500).json({ error: err.message || 'AI extraction failed' });
  }
});

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

const DEBOUNCE_VIEW_MS = 24 * 60 * 60 * 1000;

router.get('/:id', optionalProtect, async (req, res) => {
  try {
    const business = await Business.findById(req.params.id).
    populate('ownerId', 'name verified');
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
    const body = req.body || {};
    const {
      name,
      description,
      category,
      tags,
      lat,
      lng,
      address: addressRaw,
      addressStructured,
      mapDisplayName,
      contactEmail,
      vibe,
      phone,
      avgPrice: bodyAvgPrice,
      isFree,
      openingHours: openingHoursBody,
      weeklySchedule,
      menu,
      greenInitiatives,
      priceTier,
      verificationDocuments,
      socialLinks,
      menuCatalogText,
      menuCatalogFileUrl,
      localSourcingNote,
      ecoOptions,
      carbonWalkIncentive,
      notifyBuddyMeetups,
      notifyFlashDeals,
      storefrontPhotoUrl
    } = body;

    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const { hours, weekly } = mergeOpeningHoursPayload({
      weeklySchedule,
      openingHoursBody
    });

    const structured = addressStructured && typeof addressStructured === 'object' ? addressStructured : {};
    const lineFromStruct = buildAddressLine(structured, '');
    const pin = pinLine(coords[1], coords[0]);
    const address = String(addressRaw || '').trim() ||
      (lineFromStruct ? `${lineFromStruct} · ${pin}` : pin);

    const tier = coercePriceTier(priceTier);
    let avgPrice = Math.round(Number(bodyAvgPrice));
    if (!Number.isFinite(avgPrice) || avgPrice < 0) avgPrice = 0;
    const free = Boolean(isFree);
    if (!free && avgPrice === 0) avgPrice = PRICE_TIER_AVG_INR[tier] || 450;

    const eco = ecoOptions && typeof ecoOptions === 'object' ? ecoOptions : {};
    const ecoLabs = ecoInitiativeLabels(eco, Boolean(carbonWalkIncentive));
    const mergedGreen = uniqStrings([
      ...ecoLabs,
      ...(Array.isArray(greenInitiatives) ? greenInitiatives : [])
    ]);

    const social = socialLinks && typeof socialLinks === 'object' ? socialLinks : {};
    const ver = sanitizeVerificationDocs(verificationDocuments);
    const storefront = String(storefrontPhotoUrl || '').trim();
    const menuFile = String(menuCatalogFileUrl || '').trim();
    const images = [];
    if (storefront.startsWith('/uploads/')) images.push(storefront);

    const business = await Business.create({
      ownerId: req.user._id,
      name,
      mapDisplayName: String(mapDisplayName || '').trim().slice(0, 120),
      description,
      category,
      vibe: String(vibe || '').trim().slice(0, 200),
      tags: Array.isArray(tags) ? tags : [],
      location: { type: 'Point', coordinates: coords },
      address,
      addressStructured: {
        street: String(structured.street || '').trim().slice(0, 200),
        neighborhood: String(structured.neighborhood || '').trim().slice(0, 120),
        city: String(structured.city || '').trim().slice(0, 120),
        postalCode: String(structured.postalCode || '').trim().slice(0, 20)
      },
      contactEmail: String(contactEmail || '').trim().slice(0, 200),
      phone,
      avgPrice,
      priceTier: tier,
      isFree: free,
      weeklySchedule: weekly,
      openingHours: hours,
      menu: Array.isArray(menu) ? menu : [],
      menuCatalogText: String(menuCatalogText || '').trim().slice(0, 8000),
      menuCatalogFileUrl: menuFile.startsWith('/uploads/') ? menuFile.slice(0, 400) : '',
      localSourcingNote: String(localSourcingNote || '').trim().slice(0, 2000),
      greenInitiatives: mergedGreen,
      ecoOptions: {
        plasticFree: Boolean(eco.plasticFree),
        solarPowered: Boolean(eco.solarPowered),
        zeroWaste: Boolean(eco.zeroWaste)
      },
      carbonWalkIncentive: Boolean(carbonWalkIncentive),
      socialLinks: {
        website: String(social.website || '').trim().slice(0, 300),
        instagram: String(social.instagram || '').trim().slice(0, 300),
        facebook: String(social.facebook || '').trim().slice(0, 300)
      },
      verificationDocuments: ver,
      notifyBuddyMeetups: notifyBuddyMeetups !== false,
      notifyFlashDeals: notifyFlashDeals !== false,
      images,
      localKarmaScore: Math.min(100, mergedGreen.length * 10)
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
    const {
      name,
      description,
      category,
      tags,
      lat,
      lng,
      address,
      addressStructured,
      mapDisplayName,
      contactEmail,
      vibe,
      phone,
      avgPrice,
      crowdLevel,
      isFree,
      menu,
      greenInitiatives,
      openingHours: openingHoursBody,
      weeklySchedule,
      priceTier,
      verificationDocuments,
      socialLinks,
      menuCatalogText,
      menuCatalogFileUrl,
      localSourcingNote,
      ecoOptions,
      carbonWalkIncentive,
      notifyBuddyMeetups,
      notifyFlashDeals,
      storefrontPhotoUrl
    } = req.body;
    if (name) business.name = name;
    if (description !== undefined) business.description = description;
    if (category) business.category = category;
    if (tags) business.tags = tags;
    if (lat != null && lng != null) business.location.coordinates = [parseFloat(lng), parseFloat(lat)];
    if (address) business.address = address;
    if (addressStructured !== undefined && addressStructured && typeof addressStructured === 'object') {
      business.addressStructured = {
        street: String(addressStructured.street || '').trim().slice(0, 200),
        neighborhood: String(addressStructured.neighborhood || '').trim().slice(0, 120),
        city: String(addressStructured.city || '').trim().slice(0, 120),
        postalCode: String(addressStructured.postalCode || '').trim().slice(0, 20)
      };
    }
    if (mapDisplayName !== undefined) business.mapDisplayName = String(mapDisplayName || '').trim().slice(0, 120);
    if (contactEmail !== undefined) business.contactEmail = String(contactEmail || '').trim().slice(0, 200);
    if (vibe !== undefined) business.vibe = String(vibe || '').trim().slice(0, 200);
    if (phone !== undefined) business.phone = phone;
    if (avgPrice !== undefined) business.avgPrice = avgPrice;
    if (priceTier !== undefined) business.priceTier = coercePriceTier(priceTier);
    if (isFree !== undefined) business.isFree = isFree;
    if (menu !== undefined) business.menu = Array.isArray(menu) ? menu : [];
    if (menuCatalogText !== undefined) business.menuCatalogText = String(menuCatalogText || '').trim().slice(0, 8000);
    if (menuCatalogFileUrl !== undefined) {
      const mf = String(menuCatalogFileUrl || '').trim();
      business.menuCatalogFileUrl = mf.startsWith('/uploads/') ? mf.slice(0, 400) : '';
    }
    if (localSourcingNote !== undefined) business.localSourcingNote = String(localSourcingNote || '').trim().slice(0, 2000);
    if (weeklySchedule !== undefined || openingHoursBody !== undefined) {
      const { hours, weekly } = mergeOpeningHoursPayload({
        weeklySchedule: weeklySchedule !== undefined ? weeklySchedule : business.weeklySchedule,
        openingHoursBody: openingHoursBody !== undefined ? openingHoursBody : business.openingHours
      });
      if (Object.keys(weekly).length) business.weeklySchedule = weekly;
      if (Object.keys(hours).length) business.openingHours = hours;
    }
    if (socialLinks !== undefined && socialLinks && typeof socialLinks === 'object') {
      business.socialLinks = {
        website: String(socialLinks.website ?? business.socialLinks?.website ?? '').trim().slice(0, 300),
        instagram: String(socialLinks.instagram ?? business.socialLinks?.instagram ?? '').trim().slice(0, 300),
        facebook: String(socialLinks.facebook ?? business.socialLinks?.facebook ?? '').trim().slice(0, 300)
      };
    }
    if (verificationDocuments !== undefined) {
      business.verificationDocuments = sanitizeVerificationDocs(verificationDocuments);
    }
    if (ecoOptions !== undefined && ecoOptions && typeof ecoOptions === 'object') {
      business.ecoOptions = {
        plasticFree: Boolean(ecoOptions.plasticFree),
        solarPowered: Boolean(ecoOptions.solarPowered),
        zeroWaste: Boolean(ecoOptions.zeroWaste)
      };
    }
    if (carbonWalkIncentive !== undefined) business.carbonWalkIncentive = Boolean(carbonWalkIncentive);
    if (notifyBuddyMeetups !== undefined) business.notifyBuddyMeetups = Boolean(notifyBuddyMeetups);
    if (notifyFlashDeals !== undefined) business.notifyFlashDeals = Boolean(notifyFlashDeals);
    if (storefrontPhotoUrl !== undefined) {
      const sf = String(storefrontPhotoUrl || '').trim();
      if (sf.startsWith('/uploads/')) {
        const rest = (business.images || []).filter((u) => u !== sf);
        business.images = [sf, ...rest];
      }
    }
    if (greenInitiatives !== undefined) {
      const eco = business.ecoOptions || {};
      const ecoLabs = ecoInitiativeLabels(eco, Boolean(business.carbonWalkIncentive));
      business.greenInitiatives = uniqStrings([
        ...ecoLabs,
        ...(Array.isArray(greenInitiatives) ? greenInitiatives : [])
      ]);
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
      notes: canAutoVerify ? 'Auto-verified via trusted merchant account.' : 'Verification request received. Pending review.'
    };
    await business.save();
    res.json({
      ok: true,
      localVerification: business.localVerification,
      message: canAutoVerify ?
      'Local-first verification completed. Red pin activated.' :
      'Verification request submitted and pending review.'
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
    Business.deleteOne({ _id: business._id })]
    );

    await User.updateOne(
      { _id: req.user._id, businessId: business._id },
      { $unset: { businessId: 1 } }
    );

    res.json({ message: 'Business deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


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
    const peakHours = business.analytics?.peakHours instanceof Map ?
    Object.fromEntries(business.analytics.peakHours) :
    business.analytics?.peakHours || {};
    res.json({
      profileViews: business.analytics?.profileViews || 0,
      offerClicks: business.analytics?.offerClicks || 0,
      peakHours,
      daily
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;