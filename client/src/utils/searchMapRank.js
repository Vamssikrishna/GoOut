function haversineMeters(la1, lo1, la2, lo2) {
  const R = 6371e3;
  const phi1 = la1 * Math.PI / 180;
  const phi2 = la2 * Math.PI / 180;
  const dPhi = (la2 - la1) * Math.PI / 180;
  const dLambda = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Rough max typical spend from price tier when avg is missing. */
const TIER_FALLBACK_INR = { 1: 250, 2: 500, 3: 1000, 4: 2400 };

export function estimateMerchantSpendInr(business) {
  if (!business || business.isFree) return 0;
  const avg = Number(business.avgPrice);
  if (Number.isFinite(avg) && avg > 0) return avg;
  const tier = Math.min(4, Math.max(1, Math.round(Number(business.priceTier) || 2)));
  return TIER_FALLBACK_INR[tier] || 500;
}

const CHAIN_NAME_RE =
  /\b(starbucks|mcdonald|mcdonalds|kfc|subway|domino|pizza hut|burger king|costa|dunkin|taco bell|wendy|chipotle|h&m|zara|uniqlo|nike store|apple store)\b/i;

function chainPenalty(business) {
  const n = String(business?.name || '');
  return CHAIN_NAME_RE.test(n) ? 5 : 0;
}

function localIndependentBoost(business) {
  const tags = (business?.tags || []).map((t) => String(t).toLowerCase());
  if (tags.some((t) => t.includes('independent') || t.includes('local') || t.includes('artisan'))) return 4;
  const karma = Number(business?.localKarmaScore || 0);
  const pin = business?.localVerification?.redPin ? 2 : 0;
  return Math.min(6, pin + Math.min(4, karma / 25)) - chainPenalty(business);
}

function greenDiscoveryBoost(business) {
  const gi = business?.greenInitiatives || [];
  const eco = business?.ecoOptions || {};
  let n = (Array.isArray(gi) ? gi.length : 0) + (eco.plasticFree ? 1 : 0) + (eco.solarPowered ? 1 : 0) + (eco.zeroWaste ? 1 : 0);
  const tags = (business?.tags || []).map((t) => String(t).toLowerCase());
  if (tags.some((t) => /\b(vegan|organic|zero|plastic|solar|fair)\b/.test(t))) n += 1;
  return Math.min(8, n * 1.5);
}

const VIBE_EXPANSIONS = [
  { pattern: /\bquiet\b|\bpeaceful\b|\bcalm\b|\bstudy\b|\bwork\b|\blaptop\b/, add: ['quiet', 'wifi', 'cafe', 'library'] },
  { pattern: /\bview\b|\bscenic\b|\bpanorama\b|\brooftop\b/, add: ['view', 'rooftop', 'terrace', 'outdoor'] },
  { pattern: /\bdate\b|\bromantic\b|\bcozy\b/, add: ['quiet', 'cafe', 'ambiance'] },
  { pattern: /\bfamily\b|\bkids\b|\bchildren\b/, add: ['family', 'playground', 'park'] },
  { pattern: /\bcheap\b|\baffordable\b|\bfrugal\b/, add: ['budget', 'street food', 'cafe'] }
];

function expandVibeTokens(queryTokens) {
  const q = queryTokens.join(' ');
  const extra = new Set();
  VIBE_EXPANSIONS.forEach(({ pattern, add }) => {
    if (pattern.test(q)) add.forEach((t) => extra.add(t));
  });
  return [...new Set([...queryTokens, ...extra])];
}

function timeOfDayBoost(business, hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return 0;
  const cat = String(business?.category || '').toLowerCase();
  const tags = (business?.tags || []).join(' ').toLowerCase();
  const blob = `${cat} ${tags}`;
  if (h >= 5 && h < 11 && /\b(cafe|coffee|bakery|breakfast|brunch)\b/.test(blob)) return 2;
  if (h >= 17 && h < 22 && /\b(plaza|park|walk|promenade|view)\b/.test(blob)) return 2;
  if (h >= 11 && h < 15 && /\b(lunch|biryani|restaurant)\b/.test(blob)) return 1;
  return 0;
}

/**
 * Higher score = better match for map search ordering.
 */
export function businessSearchRelevanceScore(query, business) {
  const q = String(query || '').trim().toLowerCase();
  let queryTokens = tokenize(q);
  if (queryTokens.length) queryTokens = expandVibeTokens(queryTokens);
  if (!q && !queryTokens.length) return 0;

  const name = String(business?.name || '').toLowerCase();
  const category = String(business?.category || '').toLowerCase();
  const desc = String(business?.description || '').toLowerCase();
  const tags = Array.isArray(business?.tags) ? business.tags.join(' ').toLowerCase() : '';
  const haystack = `${name} ${category} ${tags} ${desc}`;
  const placeTokens = new Set(tokenize(haystack));

  let score = 0;
  if (q) {
    if (name === q) score += 12;
    if (name.startsWith(q)) score += 8;
    if (name.includes(q)) score += 6;
    if (category.includes(q)) score += 4;
    if (tags.includes(q)) score += 3;
    if (desc.includes(q)) score += 3;
  }

  queryTokens.forEach((qt) => {
    if (placeTokens.has(qt)) score += 3;
    else if (Array.from(placeTokens).some((pt) => pt.startsWith(qt) || qt.startsWith(pt))) score += 1;
    else if (desc.includes(qt) || category.includes(qt)) score += 2;
  });

  return score;
}

/**
 * Sort businesses: relevance (when query), local-first + sustainability + time-of-day, then distance.
 */
export function rankBusinessesForMapSearch(businesses, query, anchor, options = {}) {
  const list = Array.isArray(businesses) ? [...businesses] : [];
  const la = anchor?.lat;
  const lo = anchor?.lng;
  const hour = options.hour != null ? options.hour : new Date().getHours();

  return list.sort((a, b) => {
    const sa = businessSearchRelevanceScore(query, a);
    const sb = businessSearchRelevanceScore(query, b);
    if (sb !== sa) return sb - sa;

    const laBoost = localIndependentBoost(a) + greenDiscoveryBoost(a) + timeOfDayBoost(a, hour);
    const lbBoost = localIndependentBoost(b) + greenDiscoveryBoost(b) + timeOfDayBoost(b, hour);
    if (lbBoost !== laBoost) return lbBoost - laBoost;

    const alat = a?.location?.coordinates?.[1];
    const alng = a?.location?.coordinates?.[0];
    const blat = b?.location?.coordinates?.[1];
    const blng = b?.location?.coordinates?.[0];
    if (
      Number.isFinite(la) &&
      Number.isFinite(lo) &&
      Number.isFinite(alat) &&
      Number.isFinite(alng) &&
      Number.isFinite(blat) &&
      Number.isFinite(blng)
    ) {
      return haversineMeters(la, lo, alat, alng) - haversineMeters(la, lo, blat, blng);
    }
    return 0;
  });
}

export function businessIsStrongGreen(business) {
  return greenDiscoveryBoost(business) >= 4;
}
