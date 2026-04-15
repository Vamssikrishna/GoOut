import crypto from 'crypto';
import AiOnboardingCache from '../models/AiOnboardingCache.js';
import {
  createGeminiClient,
  getGenerativeModelForModelId,
  DEFAULT_GEMINI_MODEL,
  buildGeminiCandidateModels,
  classifyGeminiError,
  sleepMs,
  GEMINI_KEY_SCOPES
} from '../config/geminiConfig.js';

function cacheKey(sentence) {
  return crypto.createHash('sha256').update(String(sentence).trim().toLowerCase()).digest('hex');
}

function safeJsonParse(text) {
  let raw = String(text || '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const SYSTEM = `You help merchants register on GoOut (India-first; prices in INR).
From one sentence or short paragraph, extract a structured business profile.
Rules:
- name: concise storefront name only (no address).
- description: 1-3 sentences for customers, friendly tone.
- category: one short label (e.g. Cafe, Bakery, Salon, Bookstore).
- tags: 3-10 discovery tags (WiFi, VeganFriendly, Quiet, FamilyFriendly, etc.) when inferable.
- vibe: 2-6 words capturing atmosphere (e.g. "Cozy plant-filled nook", "Fast casual bright").
- avgPrice: integer INR for a typical single visit (meal, haircut, etc.). Use 0 if clearly free entry only.
- isFree: true only if the core offering described is free (e.g. public lookout, free samples only).
- openingHours: one line like "9 AM - 9 PM daily" if times mentioned, else "".
- greenInitiatives: only explicit eco claims (composting, solar, no plastic); else [].
- menu: up to 6 short item names if food/drink mentioned, else [].
Return ONLY valid JSON matching the schema in the user message.`;

function inferCategoryFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(cafe|coffee|espresso|latte|tea)\b/.test(t)) return 'Cafe';
  if (/\b(bakery|pastry|cake)\b/.test(t)) return 'Bakery';
  if (/\b(restaurant|diner|biryani|food|kitchen)\b/.test(t)) return 'Restaurant';
  if (/\b(salon|spa|barber|hair)\b/.test(t)) return 'Salon';
  if (/\b(book|bookstore|library)\b/.test(t)) return 'Bookstore';
  if (/\b(fashion|boutique|clothes|apparel)\b/.test(t)) return 'Boutique';
  if (/\b(grocery|mart|supermarket)\b/.test(t)) return 'Grocery';
  return 'Local Business';
}

function inferNameFromText(text, category) {
  const raw = String(text || '').trim();
  const quoted = raw.match(/["']([^"']{2,80})["']/);
  if (quoted) return quoted[1].trim();
  const byIs = raw.match(/\b(?:called|named|name is)\s+([a-z0-9&\-\s]{2,80})/i);
  if (byIs) return byIs[1].trim().replace(/[.,;:].*$/, '').trim();
  const firstChunk = raw.split(/[.,;:\n]/)[0].trim();
  if (firstChunk && firstChunk.length <= 80) return firstChunk;
  return `${category}`;
}

function inferAvgPriceInr(text, category) {
  const raw = String(text || '');
  const rs = raw.match(/(?:₹|rs\.?|inr)\s*(\d[\d,]*)/i);
  if (rs) return Number.parseInt(rs[1].replace(/,/g, ''), 10);
  const usd = raw.match(/\$\s*(\d[\d,]*)/);
  if (usd) return Math.round(Number.parseInt(usd[1].replace(/,/g, ''), 10) * 83);
  const defaults = {
    Cafe: 250,
    Bakery: 220,
    Restaurant: 450,
    Salon: 600,
    Bookstore: 400,
    Boutique: 900,
    Grocery: 500,
    'Local Business': 350
  };
  return defaults[category] || 350;
}

function heuristicOnboardingExtract(sentence) {
  const raw = String(sentence || '').trim();
  const category = inferCategoryFromText(raw);
  const name = inferNameFromText(raw, category).slice(0, 120);
  const avgPrice = inferAvgPriceInr(raw, category);
  const tagHints = [];
  if (/\b(wifi|wi-fi)\b/i.test(raw)) tagHints.push('WiFi');
  if (/\b(vegan|plant)\b/i.test(raw)) tagHints.push('VeganFriendly');
  if (/\b(family|kids)\b/i.test(raw)) tagHints.push('FamilyFriendly');
  if (/\b(quiet|calm)\b/i.test(raw)) tagHints.push('Quiet');
  if (/\b(outdoor|terrace)\b/i.test(raw)) tagHints.push('OutdoorSeating');
  if (/\b(delivery|takeaway)\b/i.test(raw)) tagHints.push('Takeaway');
  const greenInitiatives = [];
  if (/\b(plastic[-\s]?free|no plastic)\b/i.test(raw)) greenInitiatives.push('Plastic-Free');
  if (/\b(solar)\b/i.test(raw)) greenInitiatives.push('Solar Powered');
  if (/\b(compost|zero[-\s]?waste)\b/i.test(raw)) greenInitiatives.push('Zero-Waste');
  const menu = raw
    .split(/[,/]| and /i)
    .map((x) => x.trim())
    .filter((x) => x && x.length > 2 && x.length < 30)
    .slice(0, 6);
  return normalizePayload({
    name,
    description: raw.slice(0, 300),
    category,
    vibe: tagHints.includes('Quiet') ? 'Calm and welcoming' : 'Friendly neighborhood spot',
    tags: [category, ...tagHints],
    avgPrice,
    isFree: /\bfree\b/i.test(raw) && !/\bpaid|fee|charge\b/i.test(raw),
    openingHours: '',
    greenInitiatives,
    menu
  });
}

/**
 * @param {string} sentence
 * @returns {Promise<object>} normalized fields + fromCache
 */
export async function extractMerchantOnboardingFromSentence(sentence) {
  const trimmed = String(sentence || '').trim();
  if (!trimmed) throw new Error('Sentence is required');

  const key = cacheKey(trimmed);
  try {
    const hit = await AiOnboardingCache.findOne({ key }).lean();
    if (hit?.data && typeof hit.data === 'object') {
      return { ...normalizePayload(hit.data), fromCache: true };
    }
  } catch (e) {
    console.warn('[merchant onboarding ai] cache read skipped:', String(e?.message || e).slice(0, 160));
  }

  const genAI = createGeminiClient(GEMINI_KEY_SCOPES.MERCHANT);
  if (!genAI) {
    const fallback = heuristicOnboardingExtract(trimmed);
    try {
      await AiOnboardingCache.findOneAndUpdate(
        { key },
        { $set: { key, sentence: trimmed.slice(0, 2000), data: fallback } },
        { upsert: true }
      );
    } catch (e) {
      console.warn('[merchant onboarding ai] cache write skipped:', String(e?.message || e).slice(0, 160));
    }
    return { ...fallback, fromCache: false, offline: true };
  }

  const modelId = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const userText = `Merchant text:\n${trimmed}\n\nRespond with JSON only:
{"name":"string","description":"string","category":"string","tags":["string"],"avgPrice":number,"isFree":boolean,"openingHours":"string","greenInitiatives":["string"],"menu":["string"]}`;
  let parsed = null;
  let lastErr = null;
  const modelCandidates = buildGeminiCandidateModels(modelId);
  for (const candidate of modelCandidates) {
    try {
      const model = getGenerativeModelForModelId(genAI, candidate, {
        systemInstruction: SYSTEM,
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json'
        }
      });
      if (!model) continue;
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: userText }] }]
      });
      const textOut = result?.response?.text?.() || '';
      parsed = safeJsonParse(textOut);
      if (parsed && typeof parsed.name === 'string') break;
    } catch (e) {
      lastErr = e;
      const kind = classifyGeminiError(e);
      if (kind === 'transient') await sleepMs(250);
    }
  }

  const normalized = parsed && typeof parsed.name === 'string' ?
    normalizePayload(parsed) :
    heuristicOnboardingExtract(trimmed);

  try {
    await AiOnboardingCache.findOneAndUpdate(
      { key },
      { $set: { key, sentence: trimmed.slice(0, 2000), data: normalized } },
      { upsert: true }
    );
  } catch (e) {
    console.warn('[merchant onboarding ai] cache write skipped:', String(e?.message || e).slice(0, 160));
  }

  if (!parsed && lastErr) {
    console.warn('[merchant onboarding ai] using heuristic fallback:', String(lastErr?.message || lastErr).slice(0, 240));
  }
  return { ...normalized, fromCache: false, offline: !parsed };
}

function normalizePayload(parsed) {
  const tags = Array.isArray(parsed.tags) ?
    [...new Set(parsed.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 12) :
    [];
  const greenInitiatives = Array.isArray(parsed.greenInitiatives) ?
    [...new Set(parsed.greenInitiatives.map((t) => String(t).trim()).filter(Boolean))].slice(0, 10) :
    [];
  const menu = Array.isArray(parsed.menu) ?
    [...new Set(parsed.menu.map((t) => String(t).trim()).filter(Boolean))].slice(0, 8) :
    [];

  let avgPrice = Math.round(Number(parsed.avgPrice));
  if (!Number.isFinite(avgPrice) || avgPrice < 0) avgPrice = 0;
  if (avgPrice > 500000) avgPrice = 500000;

  return {
    name: String(parsed.name || '').trim().slice(0, 120),
    description: String(parsed.description || '').trim().slice(0, 2000),
    category: String(parsed.category || '').trim().slice(0, 80),
    vibe: String(parsed.vibe || '').trim().slice(0, 160),
    tags,
    avgPrice,
    isFree: Boolean(parsed.isFree),
    openingHours: String(parsed.openingHours || '').trim().slice(0, 200),
    greenInitiatives,
    menu
  };
}
