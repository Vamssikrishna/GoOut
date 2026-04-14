import express from 'express';
import Business from '../models/Business.js';
import { fetchPublicSpacesNear } from '../services/publicPlaces.js';

const router = express.Router();

const USD_TO_INR = Number(process.env.USD_INR_RATE || 83);

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

function matchesCategory(b, term) {
  const c = (b.category || '').toLowerCase();
  const tags = (b.tags || []).map((t) => String(t).toLowerCase());
  const t = term.toLowerCase();
  return c.includes(t) || tags.some((tag) => tag.includes(t));
}

function tokenize(value) {
  return String(value || '').
    toLowerCase().
    replace(/[^a-z0-9\s]/g, ' ').
    split(/\s+/).
    filter((t) => t.length >= 2);
}

const STOPWORDS = new Set([
  'near', 'nearest', 'me', 'around', 'close', 'by', 'for', 'to', 'with', 'want', 'need', 'looking',
  'find', 'show', 'please', 'best', 'good', 'cheap', 'budget', 'in', 'at', 'on', 'the', 'a', 'an', 'have', 'only', 'day'
]);

const PHRASE_ALIASES = [
  { pattern: /\bcafe\b|\bcoffee\b|\btea\b/, terms: ['cafe', 'coffee', 'tea', 'bakery'] },
  { pattern: /\bbiryani\b/, terms: ['biryani', 'restaurant', 'food'] },
  { pattern: /\bpizza\b/, terms: ['pizza', 'restaurant', 'food'] },
  { pattern: /\bburger\b/, terms: ['burger', 'restaurant', 'food'] },
  { pattern: /\bwork\b|\bstudy\b|\bworkspace\b|\bquiet\b/, terms: ['wifi', 'quiet', 'coworking', 'cafe', 'library'] },
  { pattern: /\bgym\b|\bworkout\b|\bfitness\b/, terms: ['gym', 'fitness'] },
  { pattern: /\bpark\b|\bgarden\b/, terms: ['park', 'garden', 'outdoor'] },
  { pattern: /\blibrary\b|\bbooks\b/, terms: ['library', 'bookstore', 'quiet'] },
  { pattern: /\bview\b|\bscenic\b|\bpanorama\b/, terms: ['view', 'terrace', 'rooftop', 'outdoor'] }
];

const CHAIN_RE = /\b(starbucks|mcdonald|kfc|subway|domino|pizza hut|burger king|costa|dunkin)\b/i;

function parseSearchIntent(rawQuery) {
  const query = String(rawQuery || '').toLowerCase().trim();
  const compact = query.replace(/\s+/g, ' ');
  const baseTokens = tokenize(compact).filter((t) => !STOPWORDS.has(t));
  const termSet = new Set(baseTokens);

  PHRASE_ALIASES.forEach(({ pattern, terms }) => {
    if (pattern.test(compact)) terms.forEach((t) => termSet.add(t));
  });

  const terms = Array.from(termSet);
  return {
    originalQuery: compact,
    normalizedQuery: terms.join(' ').trim(),
    terms
  };
}

/** Pull $ or ₹ amounts from natural language (e.g. "I have $20 for the day"). */
function parseInlineBudgetINR(text) {
  const t = String(text || '');
  const usd = t.match(/(?:^|\s)\$\s*(\d+(?:\.\d+)?)\b/);
  if (usd) return Math.round(parseFloat(usd[1]) * USD_TO_INR);
  const inr = t.match(/(?:₹|rs\.?)\s*(\d+(?:\.\d+)?)/i) || t.match(/\b(\d{2,6})\s*(?:inr|rupees?)\b/i);
  if (inr) return Math.round(parseFloat(inr[1]));
  return null;
}

function tierGuessInr(tier) {
  const m = { 1: 220, 2: 480, 3: 960, 4: 2200 };
  const t = Math.min(4, Math.max(1, Math.round(Number(tier) || 2)));
  return m[t] || 480;
}

function effectiveSpendInr(b) {
  if (b.isFree) return 0;
  const avg = Number(b.avgPrice);
  if (Number.isFinite(avg) && avg > 0) return avg;
  return tierGuessInr(b.priceTier);
}

function localGreenSortBonus(b) {
  const name = String(b.name || '');
  let s = 0;
  if (!CHAIN_RE.test(name)) s += 2;
  const gi = (b.greenInitiatives || []).length;
  const eco = b.ecoOptions || {};
  s += Math.min(5, gi + (eco.plasticFree ? 1 : 0) + (eco.solarPowered ? 1 : 0) + (eco.zeroWaste ? 1 : 0));
  if (b.localVerification?.redPin) s += 1.5;
  s += Math.min(3, Number(b.localKarmaScore || 0) / 40);
  return s;
}

function getQueryRelevance(business, queryText, intentTerms = []) {
  const q = String(queryText || '').trim().toLowerCase();
  const tokens = tokenize(q);
  const queryTokens = Array.from(new Set([...tokens, ...intentTerms.map((t) => String(t).toLowerCase())]));
  const name = String(business?.name || '').toLowerCase();
  const category = String(business?.category || '').toLowerCase();
  const desc = String(business?.description || '').toLowerCase();
  const tagList = Array.isArray(business?.tags) ? business.tags.map((t) => String(t).toLowerCase()) : [];
  const tags = tagList.join(' ');

  let score = 0;
  if (name === q) score += 15;
  if (name.startsWith(q)) score += 10;
  if (name.includes(q)) score += 7;
  if (category.includes(q)) score += 6;
  if (tags.includes(q)) score += 5;
  if (desc.includes(q)) score += 4;

  let matchedTokens = 0;
  queryTokens.forEach((token) => {
    const tokenInName = name.includes(token);
    const tokenInCategory = category.includes(token);
    const tokenInTags = tagList.some((tag) => tag.includes(token));
    const tokenInDesc = desc.includes(token);
    if (tokenInName || tokenInCategory || tokenInTags || tokenInDesc) {
      matchedTokens += 1;
      score += tokenInName ? 4 : tokenInCategory ? 3 : tokenInTags ? 2 : 1;
    }
  });

  const minTokenMatches = queryTokens.length > 1 ? Math.ceil(queryTokens.length * 0.5) : 1;
  const hasStrongMatch = name.includes(q) || category.includes(q) || tags.includes(q) || desc.includes(q);
  const isRelevant = !q || hasStrongMatch || matchedTokens >= minTokenMatches;

  return { score, isRelevant };
}

router.get('/itinerary', async (req, res) => {
  try {
    const { lng, lat, budget, preferences, place } = req.query;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const queryText = (place || preferences || '').toString().trim();
    const inlineBudget = parseInlineBudgetINR(queryText);
    const paramBudget = parseFloat(budget);
    let maxBudget;
    if (inlineBudget != null && inlineBudget >= 0) {
      maxBudget = inlineBudget;
    } else if (Number.isFinite(paramBudget) && paramBudget >= 0) {
      maxBudget = paramBudget;
    } else {
      return res.status(400).json({
        error: 'Enter your budget in INR (use 0 for a free-only day), or put ₹ or $ in your search text.'
      });
    }
    const intent = parseSearchIntent(queryText);
    const terms = intent.terms;

    let plan = [];
    let frugalMode = false;
    let zeroSpend = false;
    const hour = new Date().getHours();

    if (maxBudget < 1) {
      zeroSpend = true;
      frugalMode = true;
      const bias =
        hour >= 17 ?
          'well lit public plaza park evening' :
          hour >= 5 && hour < 11 ?
            'morning park cafe outdoor library' :
            'park library monument plaza garden viewpoint';
      const raw = await fetchPublicSpacesNear(coords[1], coords[0], 15000, `${intent.originalQuery} ${bias}`.trim());
      plan = (raw || []).slice(0, 14).map((p, i) => ({
        _id: `public-${i}-${String(p.name || '').slice(0, 12)}`,
        name: p.name,
        category: p.category || 'public',
        avgPrice: 0,
        isFree: true,
        isPublicStop: true,
        location: { type: 'Point', coordinates: [p.lng, p.lat] },
        distance: p.distanceMeters != null ? p.distanceMeters : getDistance(coords[1], coords[0], p.lat, p.lng)
      }));
      if (terms.length) {
        plan = plan.filter((row) =>
          terms.some((t) => String(row.name || '').toLowerCase().includes(t) || String(row.category || '').toLowerCase().includes(t))
        ).slice(0, 10);
      }
    } else if (maxBudget < 50) {
      frugalMode = true;
      const free = await Business.find({
        location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: 5000 } },
        isFree: true
      }).limit(5).populate('ownerId', 'name');
      const freePrice = await Business.find({
        location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: 5000 } },
        avgPrice: 0,
        isFree: { $ne: true }
      }).limit(8).populate('ownerId', 'name');
      const merged = [...free, ...freePrice.filter((x) => !free.some((f) => f._id.equals(x._id)))];
      const freePlan = merged.map((b) => ({
        ...b.toObject(),
        distance: getDistance(coords[1], coords[0], b.location.coordinates[1], b.location.coordinates[0]),
        avgPrice: 0
      })).sort((a, b) => a.distance - b.distance);
      plan = terms.length ?
        freePlan.filter((b) => terms.some((t) => matchesCategory(b, t) || (b.name || '').toLowerCase().includes(t.toLowerCase()))).slice(0, 6) :
        freePlan.slice(0, 6);
    } else {
      const nearby = await Business.find({
        location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: 5000 } }
      }).limit(80).populate('ownerId', 'name');

      const normalizedTerm = intent.normalizedQuery || queryText.toLowerCase();
      const scored = nearby.
        map((b) => {
          const bo = b.toObject();
          const spend = effectiveSpendInr(bo);
          const distance = getDistance(coords[1], coords[0], b.location.coordinates[1], b.location.coordinates[0]);
          const relevance = getQueryRelevance(bo, normalizedTerm, terms);
          const termBonus = terms.some((t) => matchesCategory(bo, t) || (bo.name || '').toLowerCase().includes(t.toLowerCase())) ? 2 : 0;
          const localGreen = localGreenSortBonus(bo);
          const timeHint =
            hour >= 5 && hour < 11 && /\b(cafe|coffee|bakery|breakfast)\b/i.test(`${bo.category} ${(bo.tags || []).join(' ')}`) ? 1.2 :
              hour >= 17 && hour < 22 && /\b(plaza|park|walk|view)\b/i.test(`${bo.category} ${(bo.tags || []).join(' ')}`) ? 1.2 :
                0;
          const matchScore = (normalizedTerm ? relevance.score + termBonus : 1) + localGreen + timeHint;
          return { ...bo, distance, spendEstimate: spend, matchScore, isRelevant: relevance.isRelevant };
        }).
        filter((row) => row.spendEstimate <= maxBudget && (!normalizedTerm || (row.matchScore > 0 && row.isRelevant))).
        sort((a, b) => {
          if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
          if (a.distance !== b.distance) return a.distance - b.distance;
          return (a.spendEstimate || 0) - (b.spendEstimate || 0);
        });

      if (scored.length > 0) {
        plan = scored.slice(0, 8);
      } else if (!normalizedTerm) {
        plan = nearby.
          map((b) => {
            const bo = b.toObject();
            return {
              ...bo,
              spendEstimate: effectiveSpendInr(bo),
              distance: getDistance(coords[1], coords[0], b.location.coordinates[1], b.location.coordinates[0]),
              matchScore: localGreenSortBonus(bo)
            };
          }).
          filter((row) => row.spendEstimate <= maxBudget).
          sort((a, b) => {
            if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
            if (a.distance !== b.distance) return a.distance - b.distance;
            return (a.spendEstimate || 0) - (b.spendEstimate || 0);
          }).
          slice(0, 8);
      }
    }

    const totalEstimatedInr = plan.reduce((s, row) => s + (row.isPublicStop ? 0 : effectiveSpendInr(row)), 0);
    res.json({
      plan,
      frugalMode,
      zeroSpend,
      maxBudget,
      parsedBudgetFromText: inlineBudget,
      totalEstimatedInr,
      timeBucket: new Date().getHours() < 11 ? 'morning' : new Date().getHours() < 17 ? 'day' : 'evening'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
