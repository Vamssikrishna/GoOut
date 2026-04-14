import express from 'express';
import mongoose from 'mongoose';
import Business from '../models/Business.js';
import { protect } from '../middleware/auth.js';
import {
  createGeminiClient,
  getGenerativeModelForModelId,
  DEFAULT_GEMINI_MODEL,
  buildGeminiCandidateModels
} from '../config/geminiConfig.js';
import {
  scoreMerchantOption,
  rankCompareOptions,
  buildTradeoffNudge
} from '../services/costBenefitEngine.js';

const router = express.Router();

function normalizeToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function heuristicMealItems(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const chunks = raw
    .split(/,| and |&|\n/gi)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 12);
  return chunks.map((c) => {
    const m = c.match(/^(\d+)\s+(.+)$/);
    if (m) {
      return { name: m[2].trim().slice(0, 80), qty: Math.max(1, Math.min(10, Number(m[1]))) };
    }
    return { name: c.slice(0, 80), qty: 1 };
  });
}

function safeJsonParseLoose(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim());
      } catch {}
    }
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(raw.slice(s, e + 1));
      } catch {}
    }
    return null;
  }
}

async function extractMealItemsAi(text) {
  const genAI = createGeminiClient();
  if (!genAI) return { items: heuristicMealItems(text), model: null };
  const prompt = `User says what they ate. Extract food/drink item names + quantity.
Return JSON only: {"items":[{"name":"string","qty":number}]}
- qty default 1
- max 12 items
- no explanations
Input: ${text}`;
  const candidates = buildGeminiCandidateModels(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
  for (const modelId of candidates) {
    try {
      const model = getGenerativeModelForModelId(genAI, modelId, {
        generationConfig: { temperature: 0.1, maxOutputTokens: 400, responseMimeType: 'application/json' }
      });
      if (!model) continue;
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      const txt = String(result?.response?.text?.() || '').trim();
      const parsed = safeJsonParseLoose(txt);
      const rows = Array.isArray(parsed?.items) ? parsed.items : [];
      const items = rows
        .map((r) => ({
          name: String(r?.name || '').trim().slice(0, 80),
          qty: Math.max(1, Math.min(10, Math.round(Number(r?.qty) || 1)))
        }))
        .filter((r) => r.name)
        .slice(0, 12);
      if (items.length) return { items, model: modelId };
    } catch {
      // try next model, fallback after loop
    }
  }
  return { items: heuristicMealItems(text), model: null };
}

function similarityScore(a, b) {
  const aa = normalizeToken(a).split(' ').filter(Boolean);
  const bb = normalizeToken(b).split(' ').filter(Boolean);
  if (!aa.length || !bb.length) return 0;
  let hits = 0;
  for (const t of aa) {
    if (bb.includes(t)) hits += 1;
  }
  return hits / Math.max(aa.length, bb.length);
}

function matchMenuItem(queryName, menuItems) {
  let best = null;
  let bestScore = 0;
  for (const m of menuItems || []) {
    const s = similarityScore(queryName, m?.name || '');
    if (s > bestScore) {
      best = m;
      bestScore = s;
    }
  }
  if (best && bestScore >= 0.35) return { ...best, score: bestScore };
  return null;
}

/**
 * POST body:
 * { intent?: string, transportMode?: 'walking'|'driving'|'cycling',
 *   legs: [{ businessId, durationSeconds, distanceMeters }],
 *   liveOffers?: [{ businessId, offerPrice }] }
 */
router.post('/value-scores', protect, async (req, res) => {
  try {
    const {
      intent = '',
      transportMode = 'walking',
      legs = [],
      liveOffers = []
    } = req.body || {};

    if (!Array.isArray(legs) || legs.length < 2) {
      return res.status(400).json({ error: 'Provide at least two legs with businessId, durationSeconds, distanceMeters' });
    }
    if (legs.length > 4) {
      return res.status(400).json({ error: 'Compare at most 4 places at once' });
    }

    const legIds = legs.map((l) => String(l.businessId || ''));
    if (new Set(legIds).size !== legIds.length) {
      return res.status(400).json({ error: 'Each place in a comparison must be unique' });
    }

    const offerMap = new Map();
    (liveOffers || []).forEach((o) => {
      const id = o?.businessId?.toString?.() || String(o?.businessId || '');
      if (id && o.offerPrice != null) offerMap.set(id, Number(o.offerPrice));
    });

    const ids = legs.map((l) => l.businessId).filter(Boolean);
    const objectIds = [];
    for (const id of ids) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: `Invalid business id: ${id}` });
      }
      objectIds.push(new mongoose.Types.ObjectId(id));
    }
    const businesses = await Business.find({ _id: { $in: objectIds } }).lean();
    const byId = new Map(businesses.map((b) => [String(b._id), b]));

    const scored = [];
    for (const leg of legs) {
      const id = String(leg.businessId || '');
      const b = byId.get(id);
      if (!b) {
        return res.status(404).json({ error: `Business not found: ${id}` });
      }
      const offerPrice = offerMap.has(id) ? offerMap.get(id) : undefined;
      scored.push(
        scoreMerchantOption(
          b,
          { durationSeconds: leg.durationSeconds, distanceMeters: leg.distanceMeters },
          intent,
          transportMode,
          offerPrice
        )
      );
    }

    const { sorted, topPickId, top, second } = rankCompareOptions(scored);
    const { nudge, tradeoff } = buildTradeoffNudge(top, second, intent);

    res.json({
      options: sorted,
      topPickId,
      nudge,
      tradeoff,
      transportMode,
      intentEcho: String(intent).slice(0, 200)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/meal-price-compare', protect, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const idsRaw = Array.isArray(req.body?.businessIds) ? req.body.businessIds : [];
    if (!text) return res.status(400).json({ error: 'Please enter what you ate.' });
    if (!idsRaw.length) return res.status(400).json({ error: 'Choose places to compare.' });

    const objectIds = [];
    for (const id of idsRaw.slice(0, 4)) {
      if (!mongoose.Types.ObjectId.isValid(id)) continue;
      objectIds.push(new mongoose.Types.ObjectId(id));
    }
    if (!objectIds.length) return res.status(400).json({ error: 'No valid places selected.' });

    const businesses = await Business.find({ _id: { $in: objectIds } })
      .select('name mapDisplayName menuItems avgPrice')
      .lean();
    if (!businesses.length) return res.status(404).json({ error: 'Selected places not found.' });

    const { items, model } = await extractMealItemsAi(text);
    if (!items.length) return res.status(400).json({ error: 'Could not understand meal items. Try comma-separated names.' });

    const comparisons = businesses.map((b) => {
      const menu = Array.isArray(b.menuItems) ? b.menuItems : [];
      const lines = items.map((it) => {
        const hit = matchMenuItem(it.name, menu);
        const unit = hit ? Number(hit.price) : Number(b.avgPrice || 0);
        const subtotal = Math.round((unit * it.qty) * 100) / 100;
        return {
          asked: it.name,
          qty: it.qty,
          matchedName: hit?.name || null,
          unitPrice: unit,
          subtotal
        };
      });
      const total = Math.round(lines.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;
      return {
        businessId: String(b._id),
        name: b.mapDisplayName || b.name,
        estimatedTotalInr: total,
        lines
      };
    });

    comparisons.sort((a, b) => a.estimatedTotalInr - b.estimatedTotalInr);
    res.json({
      parsedItems: items,
      comparisons,
      aiModel: model
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not compare meal prices' });
  }
});

export default router;
