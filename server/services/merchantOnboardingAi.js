import crypto from 'crypto';
import AiOnboardingCache from '../models/AiOnboardingCache.js';
import { createGeminiClient, getGenerativeModelForModelId, DEFAULT_GEMINI_MODEL } from '../config/geminiConfig.js';

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

/**
 * @param {string} sentence
 * @returns {Promise<object>} normalized fields + fromCache
 */
export async function extractMerchantOnboardingFromSentence(sentence) {
  const trimmed = String(sentence || '').trim();
  if (!trimmed) throw new Error('Sentence is required');

  const key = cacheKey(trimmed);
  const hit = await AiOnboardingCache.findOne({ key }).lean();
  if (hit?.data && typeof hit.data === 'object') {
    return { ...normalizePayload(hit.data), fromCache: true };
  }

  const genAI = createGeminiClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY is not configured on the server');
  }

  const modelId = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const model = getGenerativeModelForModelId(genAI, modelId, {
    systemInstruction: SYSTEM,
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json'
    }
  });

  const userText = `Merchant text:\n${trimmed}\n\nRespond with JSON only:
{"name":"string","description":"string","category":"string","tags":["string"],"avgPrice":number,"isFree":boolean,"openingHours":"string","greenInitiatives":["string"],"menu":["string"]}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userText }] }]
  });
  const textOut = result?.response?.text?.() || '';
  const parsed = safeJsonParse(textOut);
  if (!parsed || typeof parsed.name !== 'string') {
    throw new Error('AI returned an unreadable profile. Try rephrasing your description.');
  }

  const normalized = normalizePayload(parsed);

  await AiOnboardingCache.findOneAndUpdate(
    { key },
    { $set: { key, sentence: trimmed.slice(0, 2000), data: normalized } },
    { upsert: true }
  );

  return { ...normalized, fromCache: false };
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
