import express from 'express';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Business from '../models/Business.js';
import AiOnboardingCache from '../models/AiOnboardingCache.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

let genAI = null;

function getGenAI() {
  if (genAI) return genAI;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    genAI = new GoogleGenerativeAI(key);
    return genAI;
  } catch (e) {
    console.warn('Gemini API init failed', e.message);
    return null;
  }
}

function getGeminiKeys() {
  const parseCsv = (raw) =>
    String(raw || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

  // Accept either:
  // - GEMINI_API_KEY=<single>
  // - GEMINI_API_KEY=<k1,k2,...> (common mistaken format)
  // - GEMINI_API_KEYS=<k1,k2,...>
  const fromSingle = parseCsv(process.env.GEMINI_API_KEY);
  const fromMulti = parseCsv(process.env.GEMINI_API_KEYS);

  const all = [];
  [...fromSingle, ...fromMulti].forEach((k) => {
    if (!all.includes(k)) all.push(k);
  });
  return all;
}

function isQuotaError(err) {
  const msg = err?.message || '';
  return err?.status === 429 || /quota|rate limit|too many requests|resource has been exhausted/i.test(msg);
}

function isModelNotFoundError(err) {
  const msg = err?.message || '';
  return (
    err?.status === 404 ||
    /not found for api version|not supported for generatecontent|models\/.*is not found/i.test(msg)
  );
}

function getCandidateModels() {
  const parseCsv = (raw) =>
    String(raw || '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
  // Accept either GEMINI_MODEL (single) or comma-separated list by mistake.
  const configuredFromModel = parseCsv(process.env.GEMINI_MODEL);
  const configuredFromModels = parseCsv(process.env.GEMINI_MODELS);
  const defaults = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-8b-latest',
  ];
  const all = [...configuredFromModel, ...configuredFromModels];
  defaults.forEach((m) => {
    if (!all.includes(m)) all.push(m);
  });
  return all;
}

function normalizeSentence(sentence) {
  return String(sentence || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceCacheKey(sentence) {
  return crypto.createHash('sha256').update(normalizeSentence(sentence)).digest('hex');
}

function parseBudgetHint(message) {
  const msg = String(message || '').toLowerCase();
  const rupee = msg.match(/(?:under|below|within|max|budget)\s*₹?\s*(\d{2,6})/i) || msg.match(/₹\s*(\d{2,6})/i);
  return rupee ? Number(rupee[1]) : null;
}

function extractCategoryHints(message) {
  const msg = String(message || '').toLowerCase();
  const known = ['cafe', 'restaurant', 'hotel', 'park', 'library', 'gym', 'hospital', 'bakery', 'mall'];
  return known.filter((k) => msg.includes(k));
}

function scoreBusinessForIntent(b, { budget, categories, wantsQuiet }) {
  const name = String(b?.name || '').toLowerCase();
  const category = String(b?.category || '').toLowerCase();
  const tags = Array.isArray(b?.tags) ? b.tags.map((t) => String(t).toLowerCase()) : [];
  const price = Number(b?.avgPrice || 0);
  let score = 0;
  if (categories.length === 0) score += 2;
  if (categories.some((c) => category.includes(c) || tags.some((t) => t.includes(c)) || name.includes(c))) score += 6;
  if (budget != null && Number.isFinite(budget)) {
    if (price <= budget) score += 4;
    else score -= 4;
  } else {
    score += 1;
  }
  if (typeof b?.distanceMeters === 'number') {
    score += Math.max(0, 5 - b.distanceMeters / 1500);
  }
  if (wantsQuiet) {
    if ((b?.crowdLevel || 50) <= 35) score += 4;
    else if ((b?.crowdLevel || 50) >= 70) score -= 3;
  }
  return score;
}

function buildFallbackConciergeResponse({ businesses, message, lat, lng }) {
  const budget = parseBudgetHint(message);
  const categories = extractCategoryHints(message);
  const wantsQuiet = /quiet|calm|peace|study|work/i.test(String(message || ''));
  const ranked = [...businesses]
    .map((b) => ({ ...b, _score: scoreBusinessForIntent(b, { budget, categories, wantsQuiet }) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);

  if (ranked.length === 0) {
    return {
      message: "I couldn't find a strong match from nearby local merchants right now.",
      recommendations: [],
      mapCommands: [],
    };
  }

  const top = ranked[0];
  const recs = ranked.map((b) => ({
    businessId: String(b._id),
    name: b.name,
    reason: `${b.category} · ₹${b.avgPrice || 0} · ${Math.round((b.distanceMeters || 0) / 100) / 10} km`,
    lat: b.location?.coordinates?.[1],
    lng: b.location?.coordinates?.[0],
  }));

  return {
    message: `Best local options near you: ${recs.map((r) => r.name).join(', ')}.`,
    recommendations: recs,
    mapCommands: [
      {
        type: 'flyTo',
        lat: top.location?.coordinates?.[1],
        lng: top.location?.coordinates?.[0],
        zoom: 16,
      },
      {
        type: 'highlightMarker',
        businessId: String(top._id),
        lat: top.location?.coordinates?.[1],
        lng: top.location?.coordinates?.[0],
      },
      {
        type: 'drawRoute',
        from: { lat, lng },
        to: {
          lat: top.location?.coordinates?.[1],
          lng: top.location?.coordinates?.[0],
          label: top.name,
        },
        profile: 'walking',
      },
    ],
  };
}

async function generateSmartRegisterWithFailover(prompt) {
  const keys = getGeminiKeys();
  if (!keys.length) {
    const err = new Error('AI service not configured. Add GEMINI_API_KEY or GEMINI_API_KEYS to server/.env and restart.');
    err.status = 503;
    throw err;
  }

  let lastError = null;
  const models = getCandidateModels();
  const start = Math.floor(Math.random() * keys.length);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    const client = new GoogleGenerativeAI(key);

    for (let j = 0; j < models.length; j++) {
      const modelName = models[j];
      try {
        const model = client.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (err) {
        lastError = err;
        // Try next model if this model alias is unavailable.
        if (isModelNotFoundError(err)) continue;
        // Rotate key only for quota/rate errors.
        if (isQuotaError(err)) break;
        // For other hard errors, stop early.
        throw err;
      }
    }
  }

  throw lastError || new Error('AI request failed');
}

router.post('/chat', protect, async (req, res) => {
  try {
    if (!getGeminiKeys().length) {
      return res.status(503).json({ error: 'AI service not configured. Add GEMINI_API_KEY or GEMINI_API_KEYS in server/.env' });
    }
    const { message, context } = req.body;
    const { lng, lat } = context || {};
    const latNum = Number(lat);
    const lngNum = Number(lng);
    let nearby = [];
    if (Number.isFinite(lngNum) && Number.isFinite(latNum)) {
      nearby = await Business.find({
        location: { $nearSphere: { $geometry: { type: 'Point', coordinates: [lngNum, latNum] }, $maxDistance: 7000 } },
      })
        .limit(20)
        .select('name category avgPrice rating address location tags crowdLevel');
    }

    const contextBusinesses = nearby.map((b) => ({
      _id: String(b._id),
      name: b.name,
      category: b.category,
      avgPrice: b.avgPrice || 0,
      rating: b.rating || 0,
      address: b.address || '',
      tags: b.tags || [],
      crowdLevel: b.crowdLevel ?? 50,
      location: b.location,
      distanceMeters:
        Number.isFinite(latNum) && Number.isFinite(lngNum)
          ? (() => {
              const [blng, blat] = b.location?.coordinates || [];
              if (!Number.isFinite(blng) || !Number.isFinite(blat)) return null;
              const R = 6371e3;
              const phi1 = (latNum * Math.PI) / 180;
              const phi2 = (blat * Math.PI) / 180;
              const dPhi = ((blat - latNum) * Math.PI) / 180;
              const dLambda = ((blng - lngNum) * Math.PI) / 180;
              const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
              return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            })()
          : null,
    }));

    const systemPrompt = `You are GoOut City Concierge.
You MUST prioritize GoOut local merchants from provided JSON only.
Never invent places.
Return ONLY strict JSON with keys:
{
  "message": string,
  "recommendations": [{"businessId": string, "name": string, "reason": string, "lat": number, "lng": number}],
  "mapCommands": [
    {"type":"flyTo","lat":number,"lng":number,"zoom":number},
    {"type":"highlightMarker","businessId":string,"lat":number,"lng":number},
    {"type":"drawRoute","from":{"lat":number,"lng":number},"to":{"lat":number,"lng":number,"label":string},"profile":"walking|driving"}
  ]
}
Only include commands you can support with the given places.
User location: {"lat":${Number.isFinite(latNum) ? latNum : 'null'},"lng":${Number.isFinite(lngNum) ? lngNum : 'null'}}
Nearby local merchants JSON: ${JSON.stringify(contextBusinesses)}`;

    const fallback = buildFallbackConciergeResponse({
      businesses: contextBusinesses,
      message,
      lat: latNum,
      lng: lngNum,
    });
    try {
      const text = await generateSmartRegisterWithFailover(`${systemPrompt}\n\nUser query: ${message || 'Hello'}`);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let parsed = null;
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = null;
        }
      }

      const safePayload = {
        message: parsed?.message || fallback.message,
        recommendations: Array.isArray(parsed?.recommendations) ? parsed.recommendations : fallback.recommendations,
        mapCommands: Array.isArray(parsed?.mapCommands) ? parsed.mapCommands : fallback.mapCommands,
      };
      // Backward compatibility for old frontend readers.
      return res.json({ ...safePayload, reply: safePayload.message });
    } catch (aiErr) {
      const msg = aiErr?.message || '';
      const isQuota = aiErr?.status === 429 || /quota|rate limit|too many requests/i.test(msg);
      if (!isQuota) throw aiErr;
      // Graceful degrade on quota errors: keep concierge useful using local DB context.
      return res.json({
        ...fallback,
        reply: fallback.message,
        aiUnavailable: true,
        aiReason: 'quota_exceeded',
      });
    }
  } catch (err) {
    console.error(err);
    const msg = err.message || '';
    const isQuota = err.status === 429 || /quota|rate limit|too many requests/i.test(msg);
    const friendly = isQuota
      ? 'Gemini API quota exceeded. Wait a few minutes or check your plan at https://ai.google.dev/gemini-api/docs/rate-limits'
      : (err.message || 'AI request failed');
    res.status(isQuota ? 429 : 500).json({ error: friendly });
  }
});

const SMART_REGISTER_SYSTEM = `You extract business registration details from a single natural language description.
STRICT RULES:
- Return ONLY valid JSON. No markdown, no code fences.
- Keys: name (string), description (string), category (string), address (string), openingHours (string), menu (array of strings), tags (array of strings from description), semanticTags (array of 3-8 searchable tags like Quiet, FastWiFi, VeganFriendly), avgPrice (number), isFree (boolean), needsName (boolean), aiFilled (array of strings).
- name: Business name. If missing or vague (e.g. "my cafe", "a shop near the park") set needsName: true and leave name empty or as guessed.
- category: One word or short phrase (e.g. Cafe, Gym, Restaurant).
- address: Full address if given. If only "near X" or "by the park" leave as-is and set addressAmbiguous: true so we can use suggested location.
- openingHours: Extract if mentioned (e.g. "open 8 AM to 8 PM" -> "8 AM - 8 PM"). If not mentioned, do NOT invent; leave empty string.
- menu: Extract food/product items explicitly mentioned (e.g. idli, dosa, chai). If missing, return [].
- tags: From the description (e.g. organic, wifi, quiet). Also add semanticTags: array of short searchable tags that help users find this place (e.g. Quiet, FastWiFi, VeganFriendly, GoodForWork, Romantic, KidFriendly, PetFriendly, LateNight). Use 3-8 semantic tags. Do NOT invent facts not in the description.
- avgPrice: Only if mentioned. Otherwise 0.
- isFree: true only if they say free entry, park, library, etc.
- aiFilled: List every key that you inferred or guessed (was not clearly stated). E.g. ["phone","avgPrice"] if they didn't mention phone or price. Ensures merchant must approve inferred data.`;

router.post('/smart-register', protect, async (req, res) => {
  try {
    if (!getGeminiKeys().length && !getGenAI()) {
      return res.status(503).json({ error: 'AI service not configured. Add GEMINI_API_KEY or GEMINI_API_KEYS to server/.env and restart the server.' });
    }
    const { sentence, voiceText, suggestedLocation } = req.body;
    const descriptionInput = String(sentence || voiceText || '').trim();
    if (!descriptionInput) return res.status(400).json({ error: 'Sentence required' });

    const cacheKey = sentenceCacheKey(descriptionInput);
    const cached = await AiOnboardingCache.findOne({ key: cacheKey }).lean();
    if (cached?.data) {
      const cachedData = { ...cached.data, fromCache: true };
      if (suggestedLocation?.lat != null && suggestedLocation?.lng != null && (cachedData.addressAmbiguous === true || !cachedData.address)) {
        cachedData.suggestedLocation = { lat: suggestedLocation.lat, lng: suggestedLocation.lng };
        cachedData.suggestedLocationUsed = true;
      }
      return res.json(cachedData);
    }

    const prompt = `${SMART_REGISTER_SYSTEM}\n\nDescription: "${descriptionInput}"`;
    const text = await generateSmartRegisterWithFailover(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    if (!Array.isArray(data.aiFilled)) data.aiFilled = [];
    if (!Array.isArray(data.menu)) data.menu = [];
    await AiOnboardingCache.findOneAndUpdate(
      { key: cacheKey },
      { $set: { sentence: normalizeSentence(descriptionInput), data } },
      { upsert: true, new: true }
    );
    if (suggestedLocation?.lat != null && suggestedLocation?.lng != null && (data.addressAmbiguous === true || !data.address)) {
      data.suggestedLocation = { lat: suggestedLocation.lat, lng: suggestedLocation.lng };
      data.suggestedLocationUsed = true;
    }
    res.json(data);
  } catch (err) {
    console.error(err);
    const msg = err.message || '';
    const isQuota = err.status === 429 || /quota|rate limit|too many requests/i.test(msg);
    const friendly = isQuota
      ? 'All Gemini keys are currently quota-limited. Please continue with manual fields for now and try AI extraction later.'
      : (err.message || 'AI extraction failed');
    res.status(isQuota ? 429 : 500).json({ error: friendly });
  }
});

export default router;
