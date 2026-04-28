import Business from '../models/Business.js';
import Offer from '../models/Offer.js';
import User from '../models/User.js';
import {
  createGeminiClient,
  getGenerativeModelForModelId,
  DEFAULT_GEMINI_MODEL,
  buildGeminiCandidateModels,
  classifyGeminiError,
  sleepMs,
  GEMINI_KEY_SCOPES
} from '../config/geminiConfig.js';
import { fetchPublicSpacesNear } from './publicPlaces.js';

const USD_TO_INR = 83;

function escapeRegexChars(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function isShortDiscoveryMessage(message, searchHint) {
  const raw = String(message || '').trim();
  if (raw.length <= 56) return true;
  const words = (searchHint || '').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 6;
}

const SUSTAIN_HINTS = /\b(organic|fair\s*trade|zero\s*waste|sustainable|recycl|solar|compost|local\s*farm|artisan|handmade|eco|green|carbon|climate|ethical)\b/i;

function rankMerchantsByHint(merchants, hint, flashBusinessIdSet = null) {
  if (!merchants?.length) return [];
  const flashSet = flashBusinessIdSet instanceof Set ? flashBusinessIdSet : null;
  const blobFor = (b) =>
    `${String(b.name || '')} ${String(b.category || '')} ${(b.tags || []).map(String).join(' ')} ${(b.greenInitiatives || []).map(String).join(' ')}`.toLowerCase();
  const tokens = String(hint || '')
    .toLowerCase()
    .split(/\W+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  const scoreOf = (b) => {
    const hay = blobFor(b);
    let s = 0;
    tokens.forEach((t) => {
      if (hay.includes(t)) s += 10;
      if (String(b.category || '').toLowerCase().includes(t)) s += 6;
    });
    if (b?.localVerification?.redPin) s += 8;
    if (SUSTAIN_HINTS.test(String(hint || '')) && SUSTAIN_HINTS.test(hay)) s += 12;
    s += Math.min(6, Number(b?.localKarmaScore || 0) * 0.02);
    if (flashSet?.has(String(b._id))) s += 14;
    return s;
  };
  return [...merchants].sort((a, b) => scoreOf(b) - scoreOf(a));
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'near', 'to', 'for', 'and', 'or', 'with',
  'me', 'my', 'i', 'we', 'you', 'want', 'find', 'some', 'any', 'where', 'what', 'how', 'please',
  'under', 'below', 'than', 'less', 'more', 'there', 'from', 'this', 'that', 'can', 'could',
  'would', 'should', 'get', 'got', 'looking', 'look', 'show', 'tell', 'about', 'into', 'around'
]);

function extractSearchHint(message) {
  const normalized = String(message || '')
    .replace(/\bpls\b/gi, 'please')
    .replace(/\bnear me\b/gi, 'nearby')
    .replace(/\bwanna\b/gi, 'want to')
    .replace(/\bgonna\b/gi, 'going to')
    .replace(/\bhangout\b/gi, 'hang out')
    .replace(/\bcuz\b/gi, 'because')
    .replace(/\bvegg?\b/gi, 'vegetarian')
    .replace(/\bchai\b/gi, 'tea')
    .replace(/\btiffin\b/gi, 'breakfast')
    .replace(/\bbiryani\b/gi, 'food');
  const tokens = normalized
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .slice(0, 8);
  return tokens.join(' ') || '';
}

function normalizeDiscoveryPreferences(p) {
  if (!p || typeof p !== 'object') return { prefer: [], avoid: [], notes: '' };
  return {
    prefer: Array.isArray(p.prefer) ?
      p.prefer.map((s) => String(s || '').trim().slice(0, 120)).filter(Boolean).slice(0, 24) :
      [],
    avoid: Array.isArray(p.avoid) ?
      p.avoid.map((s) => String(s || '').trim().slice(0, 120)).filter(Boolean).slice(0, 24) :
      [],
    notes: String(p.notes || '').slice(0, 800)
  };
}

function normalizeInterests(interests) {
  if (!Array.isArray(interests)) return [];
  return interests
    .map((s) => String(s || '').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 32);
}

function tokenizePreferenceText(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function scoreTokenHits(textBlob, tokens = [], weight = 1) {
  if (!textBlob || !tokens.length) return 0;
  let score = 0;
  for (const t of tokens) {
    if (textBlob.includes(t)) score += weight;
  }
  return score;
}

function buildProfileAwareOrdering({
  merchants = [],
  publicRows = [],
  mapPois = [],
  discoveryPreferences = null,
  userInterests = [],
  rawMessage = '',
  searchHint = ''
}) {
  const dp = normalizeDiscoveryPreferences(discoveryPreferences);
  const interests = normalizeInterests(userInterests);
  const preferTokens = [...new Set(dp.prefer.flatMap((x) => tokenizePreferenceText(x)).slice(0, 80))];
  const avoidTokens = [...new Set(dp.avoid.flatMap((x) => tokenizePreferenceText(x)).slice(0, 80))];
  const interestTokens = [...new Set(interests.flatMap((x) => tokenizePreferenceText(x)).slice(0, 100))];
  const noteTokens = [...new Set(tokenizePreferenceText(dp.notes).slice(0, 120))];
  const queryTokens = [...new Set(tokenizePreferenceText(`${rawMessage} ${searchHint}`).slice(0, 80))];

  if (
    preferTokens.length === 0 &&
    avoidTokens.length === 0 &&
    interestTokens.length === 0 &&
    noteTokens.length === 0 &&
    queryTokens.length === 0
  ) {
    return { merchants, publicRows, mapPois };
  }

  const scoreMerchant = (row) => {
    const blob = [
      row?.name,
      row?.category,
      row?.address,
      row?.descriptionSnippet,
      row?.menuCatalogSnippet,
      row?.menuPriceRange,
      ...(Array.isArray(row?.tags) ? row.tags : []),
      ...(Array.isArray(row?.greenInitiatives) ? row.greenInitiatives : []),
      ...(Array.isArray(row?.menuItems) ? row.menuItems.map((m) => `${m.name || ''} ${m.description || ''}`) : []),
      ...(Array.isArray(row?.cheapestItems) ? row.cheapestItems.map((m) => `${m.name || ''} ${m.price || ''}`) : [])
    ]
      .map((x) => String(x || '').toLowerCase())
      .join(' ');

    let score = 0;
    score += scoreTokenHits(blob, preferTokens, 14);
    score += scoreTokenHits(blob, interestTokens, 10);
    score += scoreTokenHits(blob, noteTokens, 6);
    score += scoreTokenHits(blob, queryTokens, 7);
    score -= scoreTokenHits(blob, avoidTokens, 16);
    if (row?.redPin) score += 6;
    if (Number.isFinite(Number(row?.distanceMeters))) {
      const d = Number(row.distanceMeters);
      if (d <= 1200) score += 5;
      else if (d <= 3500) score += 2;
    }
    return score;
  };

  const scorePublic = (row) => {
    const blob = [
      row?.name,
      row?.category,
      row?.address,
      row?.descriptionSnippet
    ]
      .map((x) => String(x || '').toLowerCase())
      .join(' ');

    let score = 0;
    score += scoreTokenHits(blob, preferTokens, 9);
    score += scoreTokenHits(blob, interestTokens, 8);
    score += scoreTokenHits(blob, noteTokens, 5);
    score += scoreTokenHits(blob, queryTokens, 6);
    score -= scoreTokenHits(blob, avoidTokens, 12);
    if (Number.isFinite(Number(row?.distanceMeters))) {
      const d = Number(row.distanceMeters);
      if (d <= 1600) score += 3;
    }
    return score;
  };

  const merchantOrdered = [...merchants].sort((a, b) => {
    const as = scoreMerchant(a);
    const bs = scoreMerchant(b);
    if (as !== bs) return bs - as;
    const ad = Number.isFinite(Number(a?.distanceMeters)) ? Number(a.distanceMeters) : 1e9;
    const bd = Number.isFinite(Number(b?.distanceMeters)) ? Number(b.distanceMeters) : 1e9;
    return ad - bd;
  });

  const byPublicScore = (a, b) => {
    const as = scorePublic(a);
    const bs = scorePublic(b);
    if (as !== bs) return bs - as;
    const ad = Number.isFinite(Number(a?.distanceMeters)) ? Number(a.distanceMeters) : 1e9;
    const bd = Number.isFinite(Number(b?.distanceMeters)) ? Number(b.distanceMeters) : 1e9;
    return ad - bd;
  };

  return {
    merchants: merchantOrdered,
    publicRows: [...publicRows].sort(byPublicScore),
    mapPois: [...mapPois].sort(byPublicScore)
  };
}

const INTENT_PATTERNS = Object.freeze({
  quiet: /\b(quiet|peaceful|calm|silent|less\s+crowd|low\s+crowd|not\s+crowded|study|work|laptop|read|reading|focus|chill)\b/i,
  cafe: /\b(cafe|café|coffee|espresso|latte|chai|tea|brew|bakery)\b/i,
  food: /\b(food|eat|hungry|restaurant|lunch|dinner|breakfast|brunch|snack|meal|biryani|pizza|burger|thali|dosa|idli)\b/i,
  vegetarian: /\b(veg|vegetarian|vegan|plant[-\s]?based|jain)\b/i,
  spicy: /\b(spicy|masala|hot food|chilli|chili)\b/i,
  romantic: /\b(romantic|date|couple|cozy|cosy|proposal|anniversary)\b/i,
  family: /\b(family|kids|children|child|stroller|parents)\b/i,
  public: /\b(park|garden|plaza|public|library|museum|monument|landmark|outdoor|walk|trail|square|playground)\b/i,
  shopping: /\b(shop|shopping|store|gift|bookstore|books|clothes|fashion|market|artisan|handmade)\b/i,
  safe: /\b(safe|safety|meetup|meet|first\s+meet|buddy|hang\s*out|group)\b/i,
  green: /\b(green|eco|sustainable|plastic[-\s]?free|organic|carbon|walk|walking|zero\s*waste|recycle)\b/i,
  menu: /\b(menu|dish|item|items|price|prices|cost|cheap|cheapest|under|below|budget|how much)\b/i,
  openNow: /\b(open\s+now|open\s+right\s+now|currently\s+open|open today)\b/i,
  premium: /\b(best|top|premium|high\s+end|fancy|beautiful|nice|aesthetic|instagrammable|insta)\b/i
});

function matchesPatternSet(text, patternMap) {
  const out = [];
  for (const [key, re] of Object.entries(patternMap)) {
    if (re.test(text)) out.push(key);
  }
  return out;
}

function inferPlaceTypes(text) {
  const t = String(text || '');
  const types = [];
  if (INTENT_PATTERNS.cafe.test(t)) types.push('cafe');
  if (INTENT_PATTERNS.food.test(t)) types.push('restaurant_food');
  if (INTENT_PATTERNS.public.test(t)) types.push('public_place');
  if (INTENT_PATTERNS.shopping.test(t)) types.push('shopping_retail');
  if (/\b(salon|spa|haircut|beauty)\b/i.test(t)) types.push('salon_spa');
  if (/\b(gym|fitness|yoga|workout)\b/i.test(t)) types.push('fitness');
  if (/\b(bar|pub|drink|beer|wine|cocktail)\b/i.test(t)) types.push('bar_drinks');
  return [...new Set(types)];
}

function buildAdvancedRequirementIntent(rawMessage, budget, searchHint) {
  const text = String(rawMessage || '');
  const tl = text.toLowerCase();
  const requirementSignals = matchesPatternSet(text, INTENT_PATTERNS);
  const placeTypes = inferPlaceTypes(text);
  const vibeSignals = [];
  if (requirementSignals.includes('quiet')) vibeSignals.push('quiet', 'low-crowd', 'work-study-friendly');
  if (requirementSignals.includes('romantic')) vibeSignals.push('romantic', 'cozy');
  if (requirementSignals.includes('family')) vibeSignals.push('family-friendly');
  if (requirementSignals.includes('premium')) vibeSignals.push('aesthetic-high-quality');
  if (/\b(rooftop|view|scenic|sunset)\b/i.test(text)) vibeSignals.push('scenic');
  if (/\b(indoor|inside|ac)\b/i.test(text)) vibeSignals.push('indoor');
  if (/\b(outdoor|outside|open air)\b/i.test(text)) vibeSignals.push('outdoor');

  const dietarySignals = [];
  if (requirementSignals.includes('vegetarian')) dietarySignals.push('vegetarian_or_vegan');
  if (/\b(jain)\b/i.test(text)) dietarySignals.push('jain');
  if (/\b(halal)\b/i.test(text)) dietarySignals.push('halal');
  if (/\b(gluten[-\s]?free)\b/i.test(text)) dietarySignals.push('gluten_free');

  const timeSignals = [];
  if (/\b(morning|breakfast|brunch)\b/i.test(tl)) timeSignals.push('morning');
  if (/\b(afternoon|lunch)\b/i.test(tl)) timeSignals.push('afternoon');
  if (/\b(evening|tonight|dinner|night|late)\b/i.test(tl)) timeSignals.push('evening');
  if (requirementSignals.includes('openNow')) timeSignals.push('open-now-requested');

  const rankingPriorities = [];
  if (requirementSignals.includes('quiet')) rankingPriorities.push('low crowdLevel', 'quiet tags/vibe', 'library/cafe study fit');
  if (budget.maxInr != null || budget.isZeroSpend || requirementSignals.includes('menu')) rankingPriorities.push('budget/menu price fit');
  if (requirementSignals.includes('safe')) rankingPriorities.push('Red Pin / busy public safety');
  if (requirementSignals.includes('green')) rankingPriorities.push('green initiatives and walkability');
  if (requirementSignals.includes('premium')) rankingPriorities.push('rating and local quality');
  rankingPriorities.push('distance');

  const currencyMentions = [];
  if (/\$|usd|dollar/i.test(text)) currencyMentions.push('USD');
  if (/₹|inr|rupee|rs\b/i.test(text)) currencyMentions.push('INR');

  return {
    requirementSignals: [...new Set(requirementSignals)],
    placeTypes,
    vibeSignals: [...new Set(vibeSignals)],
    dietarySignals: [...new Set(dietarySignals)],
    timeSignals: [...new Set(timeSignals)],
    rankingPriorities: [...new Set(rankingPriorities)],
    needsMenuData: requirementSignals.includes('menu') || dietarySignals.length > 0,
    wantsGooglePublicContext: requirementSignals.includes('public') || placeTypes.includes('public_place'),
    wantsLocalMerchantContext: placeTypes.some((t) => t !== 'public_place') || !placeTypes.length,
    budgetMaxRupees: budget.maxInr,
    zeroSpend: budget.isZeroSpend,
    currencyMentions: [...new Set(currencyMentions)],
    locationAnchor: 'gps',
    searchHint: searchHint || null
  };
}

function menuTextForRow(row) {
  return [
    row?.menuCatalogSnippet,
    row?.menuPriceRange,
    ...(Array.isArray(row?.menuItems) ? row.menuItems.map((m) => `${m.name || ''} ${m.description || ''} ${m.price || ''}`) : []),
    ...(Array.isArray(row?.cheapestItems) ? row.cheapestItems.map((m) => `${m.name || ''} ${m.price || ''}`) : [])
  ].join(' ').toLowerCase();
}

function rowTextBlob(row) {
  return [
    row?.name,
    row?.category,
    row?.address,
    row?.descriptionSnippet,
    row?.editorialSummary,
    row?.openingHoursLine,
    row?.priceLevel,
    row?.menuPriceRange,
    row?.menuCatalogSnippet,
    ...(Array.isArray(row?.tags) ? row.tags : []),
    ...(Array.isArray(row?.types) ? row.types : []),
    ...(Array.isArray(row?.greenInitiatives) ? row.greenInitiatives : []),
    menuTextForRow(row)
  ].map((x) => String(x || '').toLowerCase()).join(' ');
}

function scoreRowForRequirement(row, parsedIntent, budget, discoveryPreferences = null, userInterests = []) {
  const blob = rowTextBlob(row);
  const signals = new Set(parsedIntent?.requirementSignals || []);
  const placeTypes = new Set(parsedIntent?.placeTypes || []);
  let score = 0;

  if (signals.has('cafe') && /\b(cafe|coffee|tea|chai|bakery|espresso|latte)\b/.test(blob)) score += 36;
  if (signals.has('food') && /\b(food|restaurant|meal|dining|biryani|pizza|burger|thali|dosa|snack|bakery)\b/.test(blob)) score += 28;
  if (signals.has('shopping') && /\b(shop|store|market|gift|book|fashion|artisan|handmade)\b/.test(blob)) score += 26;
  if (signals.has('public') && /\b(park|garden|library|museum|monument|plaza|public|landmark|trail|playground)\b/.test(blob)) score += 30;
  if (signals.has('quiet')) {
    if (/\b(quiet|peaceful|calm|library|study|work|reading|garden)\b/.test(blob)) score += 26;
    const crowd = Number(row?.crowdLevel);
    if (Number.isFinite(crowd)) score += Math.max(0, 18 - Math.round(crowd / 7));
  }
  if (signals.has('romantic') && /\b(romantic|date|cozy|cosy|view|rooftop|candle|dessert|cafe)\b/.test(blob)) score += 20;
  if (signals.has('family') && /\b(family|kids|children|playground|park|safe)\b/.test(blob)) score += 18;
  if (signals.has('vegetarian') && /\b(veg|vegetarian|vegan|plant|jain|organic|salad)\b/.test(blob)) score += 24;
  if (signals.has('spicy') && /\b(spicy|masala|chilli|chili|biryani|curry)\b/.test(blob)) score += 15;
  if (signals.has('green') && (row?.redPin || /\b(green|eco|sustainable|plastic|organic|zero waste|recycle|solar|walk)\b/.test(blob))) score += 18;
  if (signals.has('safe') && (row?.redPin || Number(row?.crowdLevel || 0) >= 42 || /\b(public|plaza|park|library)\b/.test(blob))) score += 20;
  if (signals.has('premium')) {
    score += Math.min(12, Math.max(0, Number(row?.rating || 0) * 2));
    if (Number(row?.ratingCount || 0) >= 25) score += 6;
  }

  const menuBlob = menuTextForRow(row);
  if (signals.has('menu') && menuBlob) score += 14;
  if (placeTypes.has('public_place') && row?.source && String(row.source).includes('google')) score += 5;
  if (row?.redPin) score += 10;
  if (Number.isFinite(Number(row?.distanceMeters))) {
    const d = Number(row.distanceMeters);
    if (d <= 600) score += 12;
    else if (d <= 1500) score += 8;
    else if (d <= 3500) score += 4;
  }
  if (budget?.isZeroSpend) {
    score += row?.isFree || Number(row?.avgPrice || 0) <= 0 ? 30 : -30;
  } else if (budget?.maxInr != null && Number(budget.maxInr) > 0) {
    const avg = Number(row?.avgPrice || row?.averageMenuPrice || 0);
    if (avg > 0 && avg <= Number(budget.maxInr)) score += 22;
    else if (avg > Number(budget.maxInr)) score -= Math.min(20, Math.ceil((avg - Number(budget.maxInr)) / 100));
  }

  const dp = normalizeDiscoveryPreferences(discoveryPreferences);
  const preferTokens = [...dp.prefer, dp.notes, ...normalizeInterests(userInterests)].flatMap(tokenizePreferenceText);
  const avoidTokens = dp.avoid.flatMap(tokenizePreferenceText);
  score += scoreTokenHits(blob, preferTokens, 5);
  score -= scoreTokenHits(blob, avoidTokens, 8);
  return score;
}

function applyRequirementAwareOrdering({ merchants = [], publicRows = [], mapPois = [], parsedIntent, budget, discoveryPreferences, userInterests }) {
  const hasSignals = Boolean(parsedIntent?.requirementSignals?.length || parsedIntent?.placeTypes?.length || parsedIntent?.dietarySignals?.length);
  if (!hasSignals) return { merchants, publicRows, mapPois };
  const byScore = (a, b) => {
    const bs = scoreRowForRequirement(b, parsedIntent, budget, discoveryPreferences, userInterests);
    const as = scoreRowForRequirement(a, parsedIntent, budget, discoveryPreferences, userInterests);
    if (bs !== as) return bs - as;
    const bd = Number.isFinite(Number(b?.distanceMeters)) ? Number(b.distanceMeters) : 1e9;
    const ad = Number.isFinite(Number(a?.distanceMeters)) ? Number(a.distanceMeters) : 1e9;
    return ad - bd;
  };
  return {
    merchants: [...merchants].sort(byScore),
    publicRows: [...publicRows].sort(byScore),
    mapPois: [...mapPois].sort(byScore)
  };
}

const EMOTION_PATTERNS = Object.freeze({
  bored: /\b(bored|boring|nothing to do|kill time|pass time|meh|dull)\b/i,
  sad: /\b(sad|down|upset|depressed|heartbroken|low|feeling bad|not okay)\b/i,
  happy: /\b(happy|great|awesome|excited|pumped|joyful|good mood|feeling good)\b/i,
  stressed: /\b(stressed|anxious|overwhelmed|burnt out|burned out|tense)\b/i,
  tired: /\b(tired|exhausted|drained|sleepy|low energy)\b/i,
  lonely: /\b(lonely|alone|no one to hang|need company|want company)\b/i,
  romantic: /\b(romantic|date vibe|cozy date|love vibe)\b/i,
  flirty: /\b(flirty|hotty|hot|sexy|horny|spicy mood)\b/i,
  angry: /\b(angry|mad|annoyed|irritated|frustrated)\b/i,
  calm: /\b(calm|peaceful|chill|relaxed|zen)\b/i
});

function extractEmotionSignals(rawMessage, history = []) {
  const current = String(rawMessage || '');
  const userTurns = (Array.isArray(history) ? history : [])
    .filter((h) => h?.role === 'user')
    .map((h) => String(h?.content || ''))
    .filter(Boolean)
    .slice(-8);
  const recent = userTurns.join('\n');

  const currentEmotions = [];
  const recentEmotions = [];
  for (const [emotion, re] of Object.entries(EMOTION_PATTERNS)) {
    if (re.test(current)) currentEmotions.push(emotion);
    if (re.test(recent)) recentEmotions.push(emotion);
  }

  const uniqueCurrent = [...new Set(currentEmotions)];
  const uniqueRecent = [...new Set(recentEmotions)];
  const primary = uniqueCurrent[0] || uniqueRecent[0] || null;
  const dynamicShift =
    uniqueCurrent.length > 0 &&
    uniqueRecent.length > 0 &&
    !uniqueCurrent.some((e) => uniqueRecent.includes(e));

  return {
    current: uniqueCurrent.slice(0, 4),
    recent: uniqueRecent.slice(0, 6),
    primary,
    dynamicShift
  };
}

function moodKeywordScore(blob, keywords = []) {
  if (!blob || !keywords.length) return 0;
  let score = 0;
  keywords.forEach((kw) => {
    if (blob.includes(kw)) score += 1;
  });
  return score;
}

function merchantMoodScore(row, primaryMood) {
  if (!row || !primaryMood) return 0;
  const blob = [
    row.name,
    row.category,
    row.descriptionSnippet,
    ...(Array.isArray(row.tags) ? row.tags : []),
    ...(Array.isArray(row.greenInitiatives) ? row.greenInitiatives : [])
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');

  switch (primaryMood) {
    case 'bored':
      return moodKeywordScore(blob, ['event', 'activity', 'music', 'arcade', 'market', 'hang', 'park']);
    case 'sad':
      return moodKeywordScore(blob, ['cozy', 'quiet', 'tea', 'bakery', 'garden', 'book', 'comfort']);
    case 'happy':
      return moodKeywordScore(blob, ['fun', 'dessert', 'music', 'park', 'cafe', 'brunch']);
    case 'stressed':
    case 'angry':
      return moodKeywordScore(blob, ['quiet', 'calm', 'garden', 'tea', 'library', 'peace']);
    case 'tired':
      return moodKeywordScore(blob, ['coffee', 'tea', 'brunch', 'cozy', 'bakery']);
    case 'lonely':
      return moodKeywordScore(blob, ['cafe', 'community', 'group', 'lounge', 'market', 'park']);
    case 'romantic':
      return moodKeywordScore(blob, ['cozy', 'date', 'garden', 'sunset', 'dessert', 'lounge']);
    case 'flirty':
      return moodKeywordScore(blob, ['lounge', 'dessert', 'coffee', 'cozy', 'rooftop']);
    case 'calm':
      return moodKeywordScore(blob, ['quiet', 'tea', 'library', 'garden', 'nature']);
    default:
      return 0;
  }
}

function publicMoodScore(row, primaryMood) {
  if (!row || !primaryMood) return 0;
  const blob = `${String(row.name || '').toLowerCase()} ${String(row.category || '').toLowerCase()}`;
  switch (primaryMood) {
    case 'bored':
      return moodKeywordScore(blob, ['museum', 'monument', 'market', 'plaza', 'park']);
    case 'sad':
    case 'stressed':
    case 'angry':
    case 'calm':
      return moodKeywordScore(blob, ['park', 'garden', 'lake', 'library', 'plaza']);
    case 'happy':
      return moodKeywordScore(blob, ['park', 'museum', 'plaza', 'landmark']);
    case 'lonely':
      return moodKeywordScore(blob, ['plaza', 'park', 'library', 'community']);
    case 'romantic':
    case 'flirty':
      return moodKeywordScore(blob, ['garden', 'lake', 'viewpoint', 'plaza', 'park']);
    case 'tired':
      return moodKeywordScore(blob, ['library', 'park', 'plaza']);
    default:
      return 0;
  }
}

function applyMoodAwareOrdering({ merchants = [], publicRows = [], mapPois = [], emotionSignals = null }) {
  const primaryMood = String(emotionSignals?.primary || '').toLowerCase();
  if (!primaryMood) return { merchants, publicRows, mapPois };
  const moodBoost = emotionSignals?.dynamicShift ? 22 : 14;

  const sortedMerchants = [...merchants].sort((a, b) => {
    const as = merchantMoodScore(a, primaryMood) * moodBoost;
    const bs = merchantMoodScore(b, primaryMood) * moodBoost;
    if (as !== bs) return bs - as;
    const aRed = a?.redPin ? 1 : 0;
    const bRed = b?.redPin ? 1 : 0;
    if (aRed !== bRed) return bRed - aRed;
    const ad = Number.isFinite(Number(a?.distanceMeters)) ? Number(a.distanceMeters) : 1e9;
    const bd = Number.isFinite(Number(b?.distanceMeters)) ? Number(b.distanceMeters) : 1e9;
    return ad - bd;
  });

  const byPublic = (a, b) => {
    const as = publicMoodScore(a, primaryMood) * moodBoost;
    const bs = publicMoodScore(b, primaryMood) * moodBoost;
    if (as !== bs) return bs - as;
    const ad = Number.isFinite(Number(a?.distanceMeters)) ? Number(a.distanceMeters) : 1e9;
    const bd = Number.isFinite(Number(b?.distanceMeters)) ? Number(b.distanceMeters) : 1e9;
    return ad - bd;
  };

  return {
    merchants: sortedMerchants,
    publicRows: [...publicRows].sort(byPublic),
    mapPois: [...mapPois].sort(byPublic)
  };
}

function parseIntentSummary(rawMessage, budget, searchHint) {
  const t = String(rawMessage || '');
  const tl = t.toLowerCase();
  const advanced = buildAdvancedRequirementIntent(rawMessage, budget, searchHint);
  const goalSignals = [];
  if (/\b(bored|nothing to do|kill time|surprise me|what should i do|explore|wander|hang\s*out)\b/i.test(t)) {
    goalSignals.push('open-exploration');
  }
  if (/\b(bucks?|\$\s*\d+|dollars?|rupees?|₹\s*\d+)\b/i.test(t)) goalSignals.push('budget-stated');
  if (/\b(coffee|cafe|espresso|latte|chai|tea)\b/i.test(t)) goalSignals.push('coffee');
  if (/\b(brunch|breakfast)\b/i.test(t)) goalSignals.push('brunch');
  if (/\b(lunch|dinner|biryani|eat|food|restaurant|hungry)\b/i.test(t)) goalSignals.push('food');
  if (/\b(bar|pub|drinks|wine|beer)\b/i.test(t)) goalSignals.push('drinks');
  if (/\b(shop|store|gift|book|clothes|market|artisan|handmade)\b/i.test(t)) goalSignals.push('retail');
  if (/\b(park|plaza|walk|outdoor|garden|stroll)\b/i.test(t)) goalSignals.push('outdoor');
  if (searchHint) goalSignals.push(`tokens:${searchHint.slice(0, 48)}`);

  const vibeSignals = [];
  if (/\b(quiet|peaceful|calm|study|laptop|remote\s+work|read|focus|low\s+crowd|not\s+crowded)\b/i.test(t)) vibeSignals.push('quiet');
  if (/\b(romantic|date|cozy)\b/i.test(t)) vibeSignals.push('romantic');
  if (/\b(vegan|plant[-\s]?based|vegetarian)\b/i.test(t)) vibeSignals.push('plant-forward');
  if (/\b(organic|healthy)\b/i.test(t)) vibeSignals.push('healthy');
  if (/\b(family|kids|stroller)\b/i.test(t)) vibeSignals.push('family');

  const timeSignals = [];
  if (/\b(morning|breakfast|brunch)\b/i.test(tl)) timeSignals.push('morning');
  if (/\b(afternoon|lunch)\b/i.test(tl)) timeSignals.push('afternoon');
  if (/\b(evening|tonight|dinner|night|late)\b/i.test(tl)) timeSignals.push('evening');

  const currencyMentions = [];
  if (/\$|usd|dollar/i.test(t)) currencyMentions.push('USD');
  if (/₹|inr|rupee/i.test(t)) currencyMentions.push('INR');

  return {
    ...advanced,
    goalSignals: [...new Set([...goalSignals, ...advanced.placeTypes])],
    vibeSignals: [...new Set([...vibeSignals, ...advanced.vibeSignals])],
    timeSignals: [...new Set(timeSignals)],
    currencyMentions: [...new Set(currencyMentions)],
    budgetMaxRupees: budget.maxInr,
    zeroSpend: budget.isZeroSpend,
    locationAnchor: 'gps',
    searchHint: searchHint || null
  };
}

function buildPreferenceSaveMeta(kind, val, extra = {}) {
  return {
    budgetMaxRupees: null,
    budgetNote: '',
    isZeroSpend: false,
    meetupSafety: false,
    greenMode: false,
    merchantCount: 0,
    publicSpaceCount: 0,
    mapPoiCount: 0,
    mapExplorer: { merchantsFromClient: 0, poisFromClient: 0, offersFromClient: 0 },
    geminiModel: null,
    offline: false,
    browseIntent: 'none',
    preferenceSaved: true,
    preferenceKind: kind,
    preferenceValue: val,
    ...extra
  };
}

async function tryApplyPreferenceCommand(rawMessage, userId) {
  if (!userId) return null;
  const t = String(rawMessage || '').trim();
  const prefLine = t.match(/^\s*(save|remember)\s+preference\s+(avoid|prefer)\s*:\s*(.+)$/i);
  if (prefLine) {
    const kind = prefLine[2].toLowerCase() === 'avoid' ? 'avoid' : 'prefer';
    const val = prefLine[3].trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!val) return null;
    const user = await User.findById(userId);
    if (!user) return null;
    const dp = normalizeDiscoveryPreferences(user.discoveryPreferences);
    const key = kind === 'avoid' ? 'avoid' : 'prefer';
    if (!dp[key].some((x) => x.toLowerCase() === val.toLowerCase())) {
      dp[key].unshift(val);
    }
    dp[key] = dp[key].slice(0, 24);
    user.discoveryPreferences = dp;
    await user.save();
    const verb = kind === 'avoid' ? 'down-rank or skip places that fit' : 'favor rows that match';
    return {
      reply: `Preference saved. I will ${verb} “${val}” when it lines up with names, categories, or tags in your map results.`,
      mapPan: null,
      highlightBusinessId: null,
      walkDistanceMeters: null,
      carbonCreditsNudge: null,
      nearby: { local: [], public: [], mapPois: [] },
      meta: buildPreferenceSaveMeta(kind, val)
    };
  }
  const noteLine = t.match(/^\s*save\s+preference\s+note\s*:\s*(.+)$/i);
  if (noteLine) {
    const note = noteLine[1].trim();
    if (!note) return null;
    const user = await User.findById(userId);
    if (!user) return null;
    const dp = normalizeDiscoveryPreferences(user.discoveryPreferences);
    const stamp = new Date().toISOString().slice(0, 10);
    const combined = `${dp.notes ? `${dp.notes}\n` : ''}[${stamp}] ${note}`;
    dp.notes = combined.length > 800 ? combined.slice(combined.length - 800) : combined;
    user.discoveryPreferences = dp;
    await user.save();
    return {
      reply: 'Note saved to your discovery profile — I will factor it into future suggestions when you are logged in.',
      mapPan: null,
      highlightBusinessId: null,
      walkDistanceMeters: null,
      carbonCreditsNudge: null,
      nearby: { local: [], public: [], mapPois: [] },
      meta: buildPreferenceSaveMeta(null, null, { preferenceNote: true })
    };
  }
  return null;
}

/** INR cap for avgPrice; USD amounts converted with ~${USD_TO_INR} INR/USD. Zero-spend = public + free merchants only. */
function parseBudgetContext(message) {
  const m = String(message || '');
  if (
    /\b(\$\s*0\b|₹\s*0\b|0\s*(dollars|bucks|usd|inr|rupees)|nothing to spend|no\s+money|zero\s+budget|for\s+\$0|completely\s+free)\b/i.test(
      m
    )
  ) {
    return {
      maxInr: 0,
      isZeroSpend: true,
      note: 'ZERO_SPEND: user will not pay. Recommend only free public spaces and merchants with isFree or avgPrice 0.',
      cheapPreference: false,
      multiStopBudget: false
    };
  }

  let maxInr = null;
  let note = '';

  const usdExact = m.match(/(?:exactly|only|just)\s*\$\s*(\d[\d,]*)/i);
  const usdLoose = m.match(/\$\s*(\d[\d,]*)/);
  const usdPick = usdExact || usdLoose;
  if (usdPick) {
    const n = parseInt(String(usdPick[1]).replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0) {
      maxInr = Math.round(n * USD_TO_INR);
      note = `Budget ~$${n} (treated as ≤₹${maxInr} vs merchant avgPrice in INR). Mix in free public spaces to stretch a tight day.`;
    }
  }

  const inrPatterns = [
    /(?:exactly|only|just|under|below|less\s+than)\s*[₹]?\s*(\d[\d,]*)\s*(?:rupees|inr|rs)?/i,
    /under\s*[₹rsinr]*\s*(\d[\d,]*)/i,
    /below\s*[₹rsinr]*\s*(\d[\d,]*)/i,
    /less\s+than\s*[₹rsinr]*\s*(\d[\d,]*)/i,
    /budget\s*(?:of|:)?\s*[₹rsinr$]*\s*(\d[\d,]*)/i,
    /max(?:imum)?\s*[₹rsinr$]*\s*(\d[\d,]*)/i
  ];
  if (maxInr == null) {
    for (const re of inrPatterns) {
      const x = m.match(re);
      if (x) {
        const n = parseInt(String(x[1]).replace(/,/g, ''), 10);
        if (Number.isFinite(n) && n > 0) {
          maxInr = n;
          note = `Budget about ₹${maxInr} (compare to avgPrice).`;
          break;
        }
      }
    }
  }

  const cheapPreference = /\b(cheap|cheapest|budget eats|lowest price|low cost|value picks|'\s*\$\s*'|price range\s*'\s*\$)\b/i.test(m);
  const multiStopBudget =
    /\b(under|below|less than)\s*\$\s*\d+.{0,50}\b(and|\+|plus|lunch|park|museum|coffee|tea|snack)\b/i.test(m) ||
    /\b(lunch|coffee|snack).{0,40}\b(under|below)\s*\$/i.test(m);

  return { maxInr, isZeroSpend: false, note, cheapPreference, multiStopBudget };
}

function isMeetupIntent(message) {
  return /\b(meet|meetup|date|hang\s*out|friends|group|together|social|party|buddy)\b/i.test(String(message || ''));
}

function isCasualGreeting(message) {
  const t = String(message || '').trim().toLowerCase();
  if (!t) return false;
  if (t.length <= 3) return /^(hi|hey|yo|ok|no|bye|gm|gn|ty|thx)$/i.test(t);
  return (
    /^(hi|hello|hey|hii+|yo)\b[!.\s]*$/i.test(t) ||
    /^(good\s+(morning|afternoon|evening))\b/i.test(t) ||
    /^(what'?s\s+up|sup|how\s+are\s+you|howdy)\b/i.test(t) ||
    /^(thanks|thank\s+you)\b/i.test(t)
  );
}

const BROWSE_INTENTS = new Set(['disambiguate', 'local', 'public', 'both', 'none']);

function inferBrowseIntent(message, casualGreeting, localLen, publicLen) {
  if (casualGreeting) return 'none';
  const t = String(message || '').toLowerCase();
  const hasLocalCue =
    /\b(local|merchant|business|red pin|goout|registered|cafe|coffee|restaurant|shop|store|eat|food|bar|pub|bistro|bakery|chain)\b/i.test(t);
  const hasPublicCue =
    /\b(park|garden|plaza|playground|public|outdoor|green|nature|trail|scenic|square|landmark|library|museum|monument|historic|walking\s+tour|shade|seating|free\s+to\s+visit)\b/i.test(t);
  const hybridPhrase =
    /\b(both|one .* and (one|a)|as well as|plus a|and also a|local .* public|public .* local|merchant .* park|park .* cafe|plan.*park|bakery.*park)\b/i.test(t);
  if (hybridPhrase || (hasLocalCue && hasPublicCue)) return 'both';
  if (hasPublicCue && !hasLocalCue) return 'public';
  if (hasLocalCue && !hasPublicCue) return 'local';
  if (/\b(nearby|around|close|here|places|spot|suggest|what|anything)\b/i.test(t)) {
    if (localLen > 0 && publicLen > 0) return 'disambiguate';
    if (localLen > 0) return 'local';
    if (publicLen > 0) return 'public';
  }
  if (localLen > 0 && publicLen > 0) return 'disambiguate';
  if (localLen > 0) return 'local';
  if (publicLen > 0) return 'public';
  return 'disambiguate';
}

function resolveBrowseIntent({ modelIntent, message, casualGreeting, localLen, publicLen }) {
  const m = String(modelIntent || '').toLowerCase().trim();
  if (BROWSE_INTENTS.has(m)) return m;
  return inferBrowseIntent(message, casualGreeting, localLen, publicLen);
}

function isOutOfScopePurchase(message) {
  const t = String(message || '').toLowerCase();
  if (/\b(buy(ing)?\s+a\s+car|car\s+dealership|auto\s+loan|vehicle\s+purchase|new\s+car\s+from)\b/i.test(t)) return true;
  if (/\b(buy(ing)?\s+(a\s+)?house|buy(ing)?\s+property|mortgage|home\s+loan|real\s+estate\s+purchase)\b/i.test(t) && !/\b(cafe|coffee|near|walk|shop)\b/i.test(t)) {
    return true;
  }
  return false;
}

function isIdentityMetaQuery(message) {
  return /\b(who are you|what are you|what can you do|what is goout|your capabilities|how do you work)\b/i.test(String(message || ''));
}

function mentionsOpeningHoursQuestion(message) {
  return /\b(open(ing)?\s+hours|open\s+right\s+now|open\s+now|currently\s+open|when\s+does|what\s+time\s+does|closed\s+today)\b/i.test(String(message || ''));
}

function mentionsGreenCarbonQuestion(message) {
  return /\b(carbon\s*credit|carbon\s*credits|green\s*score|green\s*mode|plastic[\s-]*free|walking[\s-]*only|maximize.*green|eco\s*route|avoid.*traffic)\b/i.test(String(message || ''));
}

function wantsFlashDealPriority(message) {
  return /\b(flash\s*deal|live\s*deal|active\s*offer|instant\s*deal|deal\s+right\s+now|discount\s+now)\b/i.test(String(message || ''));
}

function mentionsNamedWorldCity(message) {
  return /\b(paris|london|tokyo|berlin|dubai|singapore|sydney|new\s+york|los\s+angeles|mumbai|delhi|bangalore)\b/i.test(String(message || ''));
}

function mentionsLateNight(message) {
  return /\b(11\s*pm|12\s*am|midnight|late\s+night|after\s+dark|at\s+night|nighttime|evening\s+safety)\b/i.test(String(message || ''));
}

function mentionsWalkingRouteQuestion(message) {
  return /\b(how\s+long|how\s+many\s+minutes|walk(ing)?\s+from|from\s+.+\s+to\s+.+|time\s+to\s+walk)\b/i.test(String(message || ''));
}

function isHybridPlaceQuestion(message) {
  const t = String(message || '').toLowerCase();
  const dual =
    /\b(and|plus|then|after that|along with|with)\b/.test(t) &&
    /\b(cafe|coffee|restaurant|food|shop|market|bookstore|local)\b/.test(t) &&
    /\b(park|plaza|garden|public|walk|outdoor|library|museum|monument)\b/.test(t);
  const itineraryWords = /\b(itinerary|plan|route|walk plan|hybrid|mix)\b/.test(t);
  return dual || itineraryWords;
}

const GENERIC_DISCOVERY_WORDS = new Set([
  'near', 'nearby', 'around', 'here', 'there', 'place', 'places', 'spot', 'spots',
  'good', 'best', 'top', 'suggest', 'recommend', 'recommendation', 'visit', 'go', 'show',
  'find', 'looking', 'want', 'need', 'today', 'now', 'area', 'me', 'local', 'public', 'map',
  'shop', 'shops', 'store', 'stores', 'cafe', 'cafes', 'restaurant', 'restaurants'
]);

const BUDGET_ONLY_WORDS = new Set([
  'budget', 'rupee', 'rupees', 'inr', 'rs', 'dollar', 'dollars', 'usd', 'price', 'prices',
  'cheap', 'cheaper', 'cheapest', 'under', 'below', 'less', 'than', 'max', 'maximum', 'only'
]);

function extractDynamicQueryNeedles(rawMessage, searchHint) {
  const base = `${String(rawMessage || '')} ${String(searchHint || '')}`.toLowerCase();
  const tokens = base
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !STOPWORDS.has(t))
    .filter((t) => !BUDGET_ONLY_WORDS.has(t))
    .filter((t) => !GENERIC_DISCOVERY_WORDS.has(t));
  return [...new Set(tokens)].slice(0, 8);
}

function rowMatchesDynamicNeedles(row, needles) {
  if (!row || !needles?.length) return false;
  const hay = [
    row.name,
    row.category,
    row.address,
    row.descriptionSnippet,
    row.editorialSummary,
    row.menuCatalogSnippet,
    row.menuPriceRange,
    ...(Array.isArray(row.tags) ? row.tags : []),
    ...(Array.isArray(row.greenInitiatives) ? row.greenInitiatives : []),
    ...(Array.isArray(row.types) ? row.types : []),
    ...(Array.isArray(row.menuItems) ? row.menuItems.map((m) => `${m.name || ''} ${m.description || ''}`) : [])
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
  return needles.some((n) => hay.includes(n));
}

function seemsPlaceDiscoveryAsk(rawMessage) {
  return /\b(find|looking|show|where|any|suggest|recommend|want|need|best|good|near|nearby|place|spot|shop|store|cafe|restaurant|park|library|museum|gym|salon|bar|pub|theater|theatre|mall|pharmacy|hospital|bookstore)\b/i.test(String(rawMessage || ''));
}

function isBudgetDominantQuery(rawMessage) {
  const t = String(rawMessage || '').toLowerCase();
  return /\b(budget|rupees?|inr|rs|dollars?|usd|under|below|less than|max|maximum|cheap|cheapest|price)\b/.test(t) || /\d{2,}/.test(t);
}

function buildNoExactMatchReply(rawMessage, merchantPayload, publicPayload, mapPoisPayload) {
  const nearbyPublic = [...(publicPayload || []), ...(mapPoisPayload || [])].slice(0, 3);
  const nearbyLocal = (merchantPayload || []).slice(0, 3);
  const hints = [];
  if (nearbyLocal.length) {
    hints.push(`Local nearby right now: ${nearbyLocal.map((m) => m.name).join(', ')}.`);
  }
  if (nearbyPublic.length) {
    hints.push(`Public nearby right now: ${nearbyPublic.map((p) => p.name).join(', ')}.`);
  }
  return [
    `I could not find an exact match for "${String(rawMessage || '').trim()}" in your current map listings for this pin.`,
    hints.join(' '),
    'Try moving the map center or widening your search, then ask again.'
  ].filter(Boolean).join(' ');
}

function haversineMeters(la1, lo1, la2, lo2) {
  const R = 6371e3;
  const phi1 = la1 * Math.PI / 180;
  const phi2 = la2 * Math.PI / 180;
  const dPhi = (la2 - la1) * Math.PI / 180;
  const dLambda = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildGroundedQuickPicks(merchantPayload = [], publicPayload = [], mapPoisPayload = []) {
  const localLines = (merchantPayload || [])
    .slice(0, 3)
    .map((m) => {
      const bits = [
        `${m.name} (${m.category})`,
        m.redPin ? 'Red Pin' : null,
        Number.isFinite(Number(m.distanceMeters)) ? `${Math.round(Number(m.distanceMeters))}m` : null,
        Number(m.avgPrice) > 0 ? `~₹${m.avgPrice}` : m.isFree ? 'free' : null
      ].filter(Boolean);
      return `• ${bits.join(' · ')}`;
    });
  const publicRows = [...(publicPayload || []), ...(mapPoisPayload || [])];
  const publicLines = publicRows
    .slice(0, 2)
    .map((p) => {
      const bits = [
        `${p.name} (${p.category || 'public'})`,
        Number.isFinite(Number(p.distanceMeters)) ? `${Math.round(Number(p.distanceMeters))}m` : null
      ].filter(Boolean);
      return `• ${bits.join(' · ')}`;
    });
  return { localLines, publicLines };
}

/**
 * Guardrail: if model claims data is unavailable while rows exist, auto-repair with grounded picks.
 */
function repairReplyIfPublicOnlyApology(reply, merchantPayload, publicPayload = [], mapPoisPayload = [], budget = null) {
  if (!merchantPayload?.length && !(publicPayload?.length || mapPoisPayload?.length)) return String(reply || '');
  const r = String(reply || '').trim();
  if (!r) return r;
  const catalog = [...(merchantPayload || []), ...(publicPayload || []), ...(mapPoisPayload || [])];
  const mentionsKnownPlace = catalog.some((p) => p?.name && r.toLowerCase().includes(String(p.name).toLowerCase()));
  const claimsNoLocal =
    /\b(no|not|don'?t have|do not have|empty|missing).{0,36}(local (merchant|shop|cafe|business|listing|listings|data)|goout merchant)\b/i.test(r) ||
    /\b(no local listings|no local merchants)\b/i.test(r);
  const claimsNoPublic =
    /\b(no|not|don'?t have|do not have|without).{0,30}(public (place|places|listings|data)|parks?)\b/i.test(r);
  const falseNoLocal = claimsNoLocal && merchantPayload.length > 0;
  const falseNoPublic = claimsNoPublic && (publicPayload.length > 0 || mapPoisPayload.length > 0);
  if (!falseNoLocal && !falseNoPublic) return r;
  if (mentionsKnownPlace && !falseNoLocal && !falseNoPublic) return r;

  const { localLines, publicLines } = buildGroundedQuickPicks(merchantPayload, publicPayload, mapPoisPayload);
  const blocks = [];
  if (localLines.length) {
    blocks.push(`Local nearby (grounded):\n${localLines.join('\n')}`);
  }
  if (publicLines.length) {
    blocks.push(`Public nearby (grounded):\n${publicLines.join('\n')}`);
  }
  if (budget?.maxInr != null && budget.maxInr > 0) {
    blocks.push(`Budget note: shown options are nearby grounded data; prioritize those close to your ₹${budget.maxInr} target.`);
  }
  return `${blocks.join('\n\n')}\n\n${r}`.trim();
}

function ensureDiscoveryReplyContainsGroundedNames(rawMessage, reply, merchantPayload, publicPayload = [], mapPoisPayload = []) {
  const out = String(reply || '').trim();
  if (!out) return out;
  if (!seemsPlaceDiscoveryAsk(rawMessage)) return out;
  const combined = [...(merchantPayload || []), ...(publicPayload || []), ...(mapPoisPayload || [])];
  if (!combined.length) return out;
  const hasKnownPlaceMention = combined.some((p) => p?.name && out.toLowerCase().includes(String(p.name).toLowerCase()));
  if (hasKnownPlaceMention) return out;
  const { localLines, publicLines } = buildGroundedQuickPicks(merchantPayload, publicPayload, mapPoisPayload);
  const grounded = [...localLines, ...publicLines].slice(0, 3);
  if (!grounded.length) return out;
  return `${out}\n\nQuick grounded picks:\n${grounded.join('\n')}`.trim();
}

function formatOpeningHoursLine(b) {
  const oh = b?.openingHours;
  if (oh == null) return '';
  if (oh instanceof Map) {
    const parts = [...oh].map(([k, v]) => `${k}:${String(v)}`).filter(Boolean);
    return parts.join('; ').slice(0, 120);
  }
  if (typeof oh === 'object' && !Array.isArray(oh)) {
    return Object.entries(oh)
      .map(([k, v]) => `${k}:${String(v)}`)
      .join('; ')
      .slice(0, 120);
  }
  return String(oh).slice(0, 120);
}

function ecoConciergeRank(b) {
  let s = 0;
  if (b?.localVerification?.redPin) s += 25;
  s += Math.min(18, (b?.greenInitiatives || []).length * 4);
  const eco = b?.ecoOptions || {};
  if (eco.plasticFree) s += 10;
  if (eco.solarPowered) s += 10;
  if (eco.zeroWaste) s += 10;
  if (b?.carbonWalkIncentive) s += 6;
  const tags = (b?.tags || []).join(' ').toLowerCase();
  if (/\b(organic|vegan|local|artisan|fair|compost)\b/.test(tags)) s += 8;
  return s;
}

async function fetchOpenMeteoBrief(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lng)}&current=temperature_2m,weather_code&timezone=auto`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4500);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    const data = await resp.json();
    const temp = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;
    if (!Number.isFinite(temp) && !Number.isFinite(code)) return null;
    let sky = 'mixed skies';
    if (code === 0 || code === 1) sky = 'mostly clear / sunny';
    else if (code >= 2 && code <= 48) sky = 'partly cloudy';
    else if (code >= 51 && code <= 67) sky = 'rain likely';
    else if (code >= 71 && code <= 77) sky = 'snow possible';
    return `WEATHER_NOW: ~${Number.isFinite(temp) ? `${Math.round(temp)}°C` : 'unknown temp'}, ${sky} — good moment to suggest walking when it is pleasant.`;
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

function summarizeMenuData(source) {
  const rawItems = Array.isArray(source?.menuItems) ? source.menuItems : [];
  const menuItems = rawItems
    .map((item) => {
      const name = String(item?.name || '').trim().slice(0, 90);
      const price = Number(item?.price);
      const description = String(item?.description || '').trim().replace(/\s+/g, ' ').slice(0, 140);
      if (!name || !Number.isFinite(price) || price < 0) return null;
      return { name, price: Math.round(price), description };
    })
    .filter(Boolean)
    .slice(0, 16);
  const prices = menuItems.map((m) => Number(m.price)).filter((n) => Number.isFinite(n));
  const cheapestItems = [...menuItems].sort((a, b) => a.price - b.price).slice(0, 5);
  const averageMenuPrice = prices.length ?
    Math.round(prices.reduce((sum, n) => sum + n, 0) / prices.length) :
    null;
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  const menuCatalogSnippet = String(source?.menuCatalogText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
  const menuCatalogFileUrl = String(source?.menuCatalogFileUrl || '').trim().slice(0, 400);
  return {
    menuItems,
    cheapestItems,
    averageMenuPrice,
    menuPriceRange: min != null && max != null ? `₹${min}-${max}` : '',
    menuCatalogSnippet,
    menuCatalogFileUrl: menuCatalogFileUrl.startsWith('/uploads/') ? menuCatalogFileUrl : ''
  };
}

function serializeMerchant(b, userLat, userLng) {
  const coords = b?.location?.coordinates || [];
  const lng = coords[0];
  const lat = coords[1];
  const dist =
    Number.isFinite(userLat) && Number.isFinite(userLng) && Number.isFinite(lat) && Number.isFinite(lng) ?
      Math.round(haversineMeters(userLat, userLng, lat, lng)) :
      null;
  const gi = Array.isArray(b.greenInitiatives) ? b.greenInitiatives.filter(Boolean) : [];
  const tags = Array.isArray(b.tags) ? b.tags.filter(Boolean) : [];
  const eco = b.ecoOptions || {};
  const ecoSnippet = [
    eco.plasticFree ? 'plastic-free' : null,
    eco.solarPowered ? 'solar' : null,
    eco.zeroWaste ? 'zero-waste' : null
  ].
    filter(Boolean).
    join(';');
  const menuSummary = summarizeMenuData(b);
  return {
    id: String(b._id),
    name: b.name,
    category: b.category,
    tags,
    greenInitiatives: gi,
    ecoSnippet,
    carbonWalkIncentive: Boolean(b.carbonWalkIncentive),
    descriptionSnippet: String(b.description || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140),
    avgPrice: b.avgPrice ?? 0,
    isFree: Boolean(b.isFree),
    rating: b.rating ?? 0,
    address: b.address,
    redPin: Boolean(b.localVerification?.redPin),
    verificationStatus: b.localVerification?.status || 'none',
    crowdLevel: b.crowdLevel ?? 50,
    openingHoursLine: formatOpeningHoursLine(b),
    ...menuSummary,
    lat,
    lng,
    distanceMeters: dist
  };
}

function serializePublic(p) {
  return {
    id: String(p.id),
    name: p.name,
    category: p.category,
    types: Array.isArray(p.types) ? p.types.slice(0, 10) : [],
    address: String(p.address || '').slice(0, 180),
    rating: p.rating ?? null,
    ratingCount: p.ratingCount ?? null,
    priceLevel: p.priceLevel || '',
    openingHoursText: Array.isArray(p.openingHoursText) ? p.openingHoursText.slice(0, 7) : [],
    websiteUri: String(p.websiteUri || '').slice(0, 240),
    phone: String(p.phone || '').slice(0, 80),
    editorialSummary: String(p.editorialSummary || '').replace(/\s+/g, ' ').trim().slice(0, 260),
    lat: p.lat,
    lng: p.lng,
    distanceMeters: p.distanceMeters != null ? Math.round(p.distanceMeters) : null,
    source: p.source || 'public'
  };
}

function sanitizeMapContext(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const businesses = Array.isArray(raw.businesses) ? raw.businesses.slice(0, 1500) : [];
  const pois = Array.isArray(raw.pois) ? raw.pois.slice(0, 2000) : [];
  const offers = Array.isArray(raw.offers) ? raw.offers.slice(0, 300) : [];
  if (!businesses.length && !pois.length && !offers.length) return null;
  return { businesses, pois, offers };
}

/** Same shape as serializeMerchant from Explorer JSON (lean / populated). */
function serializeMapContextBusiness(b, userLat, userLng) {
  const id = String(b._id ?? b.id ?? '').trim();
  if (!id || id === 'undefined') return null;
  let lat = Number(b.lat);
  let lng = Number(b.lng);
  const coords = b.location?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    lng = Number(coords[0]);
    lat = Number(coords[1]);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const distFromClient = Number(b.distanceMeters ?? b.distance);
  const dist =
    Number.isFinite(distFromClient) && distFromClient >= 0 ?
      Math.round(distFromClient) :
      (Number.isFinite(userLat) && Number.isFinite(userLng) ?
        Math.round(haversineMeters(userLat, userLng, lat, lng)) :
        null);
  const tags = Array.isArray(b.tags) ? b.tags.map(String).filter(Boolean).slice(0, 12) : [];
  const gi = Array.isArray(b.greenInitiatives) ? b.greenInitiatives.map(String).filter(Boolean).slice(0, 8) : [];
  const redPin = Boolean(b.redPin ?? b.localVerification?.redPin);
  const eco = b.ecoOptions || {};
  const ecoSnippet = [
    eco.plasticFree ? 'plastic-free' : null,
    eco.solarPowered ? 'solar' : null,
    eco.zeroWaste ? 'zero-waste' : null
  ].
    filter(Boolean).
    join(';');
  const menuSummary = summarizeMenuData(b);
  return {
    id,
    name: String(b.name || 'Unknown').slice(0, 120),
    category: String(b.category || '').slice(0, 80),
    tags,
    greenInitiatives: gi,
    ecoSnippet,
    carbonWalkIncentive: Boolean(b.carbonWalkIncentive),
    descriptionSnippet: String(b.description || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140),
    avgPrice: b.avgPrice ?? 0,
    isFree: Boolean(b.isFree),
    rating: b.rating ?? 0,
    address: String(b.address || '').slice(0, 120),
    redPin,
    verificationStatus: b.localVerification?.status || (redPin ? 'verified' : 'none'),
    crowdLevel: b.crowdLevel ?? 50,
    openingHoursLine: formatOpeningHoursLine(b),
    ...menuSummary,
    lat,
    lng,
    distanceMeters: dist,
    source: 'explorer_map'
  };
}

function mergeMerchantsWithMapContext(dbPayload, mapContext, userLat, userLng) {
  const mc = sanitizeMapContext(mapContext);
  if (!mc?.businesses?.length) return dbPayload;
  const fromMap = mc.businesses
    .map((b) => serializeMapContextBusiness(b, userLat, userLng))
    .filter(Boolean);
  if (!fromMap.length) return dbPayload;
  const mapIds = new Set(fromMap.map((m) => m.id));
  const rest = dbPayload.filter((m) => !mapIds.has(m.id));
  return [...fromMap, ...rest];
}

function serializeMapContextPoi(p, userLat, userLng) {
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const dist =
    p.distanceMeters != null && Number.isFinite(Number(p.distanceMeters)) ?
      Math.round(Number(p.distanceMeters)) :
      (Number.isFinite(userLat) && Number.isFinite(userLng) ?
        Math.round(haversineMeters(userLat, userLng, lat, lng)) :
        null);
  return {
    id: String(p.id ?? `poi-${lat.toFixed(4)},${lng.toFixed(4)}`),
    name: String(p.name || 'Place'),
    category: String(p.category || 'poi'),
    lat,
    lng,
    distanceMeters: dist,
    source: 'explorer_search'
  };
}

function isFlashOfferStillValid(validUntilIso, nowMs = Date.now()) {
  if (!validUntilIso || !String(validUntilIso).trim()) return true;
  const vu = new Date(validUntilIso).getTime();
  return !Number.isFinite(vu) || vu > nowMs;
}

function mergeMapContextFlashOffers(serverList, mapOffers, merchantPayload) {
  const nowMs = Date.now();
  const nameById = new Map((merchantPayload || []).map((m) => [m.id, m.name]));
  const out = [...(serverList || [])].filter((x) => isFlashOfferStillValid(x.validUntilIso, nowMs));
  const seen = new Set(out.map((s) => `${s.businessId}|${s.title}`));
  for (const o of mapOffers || []) {
    const bid = String(o?.businessId?._id || o?.businessId || '');
    if (!bid) continue;
    const vuRaw = o.validUntil;
    const validUntilIso = vuRaw ? new Date(vuRaw).toISOString() : '';
    if (!isFlashOfferStillValid(validUntilIso, nowMs)) continue;
    const title = String(o?.title || 'Deal');
    const key = `${bid}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      businessId: bid,
      merchantName: String(o?.businessId?.name || nameById.get(bid) || 'Merchant'),
      title,
      offerPrice: Number(o.offerPrice) || 0,
      validUntilIso
    });
  }
  return out.slice(0, 28);
}

/**
 * Active flash deals for businesses in the exploration radius — independent of
 * budget / search filters on the merchant list, so the model sees the same
 * live deals as the map feed (within the same radius cap).
 */
async function fetchFlashOffersNear(coords, maxDistanceM) {
  const d = Number(maxDistanceM);
  if (!Array.isArray(coords) || coords.length < 2 || !Number.isFinite(d) || d < 50) return [];
  const businesses = await Business.find({
    location: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: coords },
        $maxDistance: d
      }
    }
  })
    .select('_id')
    .limit(220)
    .lean();
  const ids = businesses.map((b) => b._id);
  if (!ids.length) return [];
  return Offer.find({
    businessId: { $in: ids },
    isActive: true,
    validUntil: { $gt: new Date() }
  })
    .populate('businessId', 'name')
    .sort({ validUntil: 1 })
    .limit(32)
    .lean();
}

/** Diet / vibe signals from recent chat turns (session memory without DB). */
function extractSessionSignalsFromHistory(history) {
  const arr = Array.isArray(history) ? history.slice(-14) : [];
  const blob = arr.map((h) => `${h.role}:${h.content}`).join('\n').toLowerCase();
  if (!blob.trim()) return [];
  const signals = [];
  if (/\b(i am|i'm|im)\s+vegan\b|\bvegan\b|\bplant[-\s]?based\b|\bno dairy\b/i.test(blob)) signals.push('diet:vegan');
  if (/\bvegetarian\b|\bveg\s+(food|only)\b/i.test(blob)) signals.push('diet:vegetarian');
  if (/\bhalal\b|\bkosher\b/i.test(blob)) signals.push('diet:halal-kosher');
  if (/\b(allergic|allergy|nut allergy|gluten)\b/i.test(blob)) signals.push('caution:allergies');
  if (/\b(no |avoid |don't like |hate |dislike ).{0,48}\b(meat|steak|beef|pork|bbq|barbecue)\b/i.test(blob)) signals.push('avoid:heavy-meat');
  if (/\b(no |avoid ).{0,24}\b(fish|seafood)\b/i.test(blob)) signals.push('avoid:seafood');
  if (/\bquiet\b|\bnot loud\b|\blow noise\b/i.test(blob)) signals.push('vibe:quiet');
  if (/\bloud\b|\bparty vibe\b|\benergy\b/i.test(blob)) signals.push('vibe:lively');
  return [...new Set(signals)];
}

function scoreNameMatch(name, needle) {
  const a = String(name || '').toLowerCase();
  const b = String(needle || '')
    .toLowerCase()
    .trim()
    .replace(/\?+$/, '');
  if (!b) return 0;
  if (a === b) return 100;
  if (a.includes(b)) return 85;
  const parts = b.split(/\s+/).filter((w) => w.length > 2);
  if (!parts.length) return 0;
  return parts.reduce((acc, w) => acc + (a.includes(w) ? 28 : 0), 0);
}

function bestPlaceByName(needle, merchants, publics) {
  let best = null;
  let bestScore = 0;
  for (const m of merchants) {
    const s = scoreNameMatch(m.name, needle);
    if (s > bestScore) {
      best = { ...m, _kind: 'local' };
      bestScore = s;
    }
  }
  for (const p of publics) {
    const s = scoreNameMatch(p.name, needle);
    if (s > bestScore) {
      best = { ...p, _kind: 'public' };
      bestScore = s;
    }
  }
  return bestScore >= 35 ? best : null;
}

function extractFromToPhrases(message) {
  const m = String(message || '').replace(/\s+/g, ' ');
  let x = m.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\?|$)/i);
  if (x) return { from: x[1].trim(), to: x[2].trim().replace(/\?+$/, '').trim() };
  x = m.match(/\bwalk(?:ing)?\s+from\s+(.+?)\s+to\s+(.+?)(?:\?|$)/i);
  if (x) return { from: x[1].trim(), to: x[2].trim().replace(/\?+$/, '').trim() };
  return null;
}

async function fetchGoogleWalkingSummary(origin, destination) {
  const key = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!key) return null;
  const oLat = origin.lat;
  const oLng = origin.lng;
  const dLat = destination.lat;
  const dLng = destination.lng;
  if (![oLat, oLng, dLat, dLng].every((n) => Number.isFinite(n))) return null;
  const url =
    `https://maps.googleapis.com/maps/api/directions/json?` +
    `origin=${encodeURIComponent(`${oLat},${oLng}`)}` +
    `&destination=${encodeURIComponent(`${dLat},${dLng}`)}` +
    `&mode=walking&key=${encodeURIComponent(key)}`;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) return null;
    const leg = data.routes[0].legs[0];
    return {
      durationText: leg.duration?.text,
      distanceText: leg.distance?.text,
      durationSeconds: leg.duration?.value,
      distanceMeters: leg.distance?.value
    };
  } catch {
    return null;
  }
}

async function buildWalkingDirectionsAppendix(message, merchants, publics) {
  if (!mentionsWalkingRouteQuestion(message)) return '';
  const pair = extractFromToPhrases(message);
  if (!pair) return '';
  const a = bestPlaceByName(pair.from, merchants, publics);
  const b = bestPlaceByName(pair.to, merchants, publics);
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) {
    return `\nWALKING_ROUTE: Could not match both endpoints in lists for "${pair.from}" → "${pair.to}".`;
  }
  const route = await fetchGoogleWalkingSummary({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  if (!route) {
    return `\nWALKING_ROUTE: Straight-line ~${Math.round(haversineMeters(a.lat, a.lng, b.lat, b.lng))}m between "${a.name}" and "${b.name}" (Google walking directions unavailable).`;
  }
  return `\nWALKING_ROUTE_GOOGLE: From "${a.name}" to "${b.name}": ${route.durationText} walking, ${route.distanceText}.`;
}

async function buildAutoHybridRouteAppendix(message, merchants, publics) {
  if (!isHybridPlaceQuestion(message)) return '';
  const a = merchants?.[0];
  const b = publics?.[0];
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
    return '';
  }
  const route = await fetchGoogleWalkingSummary({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  if (route?.durationText && route?.distanceText) {
    return `\nHYBRID_ROUTE_HINT: Suggested hybrid order: "${a.name}" then "${b.name}" (~${route.durationText} walk, ${route.distanceText}).`;
  }
  const meters = Math.round(haversineMeters(a.lat, a.lng, b.lat, b.lng));
  return `\nHYBRID_ROUTE_HINT: Suggested hybrid order: "${a.name}" then "${b.name}" (~${meters}m walk).`;
}

function formatContextForPrompt(
  merchants,
  publicPlaces,
  {
    userLat,
    userLng,
    budget,
    meetupSafety,
    greenMode,
    serverIso,
    walkingAppendix,
    contextNotes = [],
    rawMessage = '',
    publicFetchAttempted = false,
    liveFlashOffers = [],
    mapPois = [],
    hasExplorerMapMerchants = false,
    discoveryPreferences = null,
    userInterests = [],
    parsedIntent = null,
    emotionSignals = null,
    liveMapSyncLine = '',
    sessionSignals = [],
    explorationRadiusM = null,
    userActivitySnapshot = null,
    userProfileSnapshot = null,
    userVisitsSnapshot = []
  }
) {
  const lines = [];
  lines.push(`User location (lat,lng): ${userLat}, ${userLng}`);
  const er = Number(explorationRadiusM);
  if (Number.isFinite(er) && er >= 200) {
    lines.push(`Explorer search radius (merchants + public fetch): ~${Math.round(er / 100) / 10} km`);
  }
  lines.push(`Server time (UTC): ${serverIso}`);
  lines.push('');
  lines.push(
    `TEMPORAL_RULES: Treat ${serverIso} as "now". Do not call any LIVE_FLASH_DEAL active if its validUntilIso is on or before that timestamp. Parks, plazas, and libraries may have hours or gates you cannot see — say to verify locally rather than claiming open/closed.`
  );
  lines.push('');
  if (liveMapSyncLine) {
    lines.push(liveMapSyncLine);
    lines.push('');
  }
  lines.push(
    `DATA_AVAILABILITY: ${merchants.length} LOCAL_MERCHANT row(s)` +
      (hasExplorerMapMerchants ? ' (Explorer map pins sent first in this list — stay consistent with those names).' : '') +
      `. ` +
      (mapPois.length ? `${mapPois.length} MAP_POI search pin(s) from Explorer. ` : '') +
      (publicFetchAttempted ?
        (publicPlaces.length ?
          `Public fetch returned ${publicPlaces.length} place(s).` :
          'Public fetch ran but returned 0 places (API/geodata empty for this pin).') :
        'Public fetch was skipped (short greeting).') +
      ' If LOCAL_MERCHANT count > 0, you MUST answer with those merchants whenever the user asks about food, shops, nearby picks, prices, Red Pin, or generic "what is good" — do not treat empty public results as "no data".' +
      ' PUBLIC_SPACES lists parks, libraries, attractions and similar near the same radius when fetched — treat them as real options for outdoor/civic questions.' +
      (Array.isArray(liveFlashOffers) && liveFlashOffers.length ?
        ` LIVE_FLASH_DEALS includes ${liveFlashOffers.length} active offer(s) in this radius; a merchant can appear there even if not in LOCAL_MERCHANTS (e.g. budget filter) — still use LIVE_FLASH_DEALS for flash-deal questions.` :
        '')
  );
  if (contextNotes.length) {
    lines.push('');
    contextNotes.forEach((n) => lines.push(n));
  }
  if (budget.note) lines.push(budget.note);
  if (budget.cheapPreference) {
    lines.push('User asked for cheap / lowest-price tier: prefer merchants with lower avgPrice among matches.');
  }
  if (budget.multiStopBudget) {
    lines.push('User may be splitting one budget across multiple stops (e.g. lunch + park): suggest combinations whose typical avgPrice sum fits their cap.');
  }
  const dp = normalizeDiscoveryPreferences(discoveryPreferences);
  const normalizedInterests = normalizeInterests(userInterests);
  if (dp.prefer.length || dp.avoid.length || dp.notes) {
    lines.push('');
    lines.push('USER_DISCOVERY_MEMORY (this logged-in user — filter and rank accordingly):');
    if (dp.prefer.length) lines.push(`Prefer: ${dp.prefer.join(' · ')}`);
    if (dp.avoid.length) lines.push(`Avoid / dislike: ${dp.avoid.join(' · ')}`);
    if (dp.notes) lines.push(`Notes: ${dp.notes.slice(0, 500)}`);
  }
  if (normalizedInterests.length) {
    lines.push(`Profile interests: ${normalizedInterests.join(' · ')}`);
  }
  if (sessionSignals.length) {
    lines.push('');
    lines.push(
      `SESSION_FROM_CHAT_HISTORY (recent messages in this chat — apply without being asked again): ${sessionSignals.join(' · ')}. Example: diet:vegan means down-rank steakhouses/bbq and favor plant-forward tags.`
    );
  }
  const act = userActivitySnapshot && typeof userActivitySnapshot === 'object' ? userActivitySnapshot : null;
  if (act) {
    lines.push('');
    lines.push(
      'USER_ACTIVITY (logged-in explorer — from our database; cite only these numbers, do not invent):'
    );
    lines.push(
      `Visits logged: ${act.visitCount} · Total walk distance (visits): ${Math.round(Number(act.totalWalkDistanceMeters) || 0)} m · Approx. calories from those walks: ${act.approximateCaloriesFromVisits ?? 'n/a'} (uses profile weight when set)`
    );
    const gs = act.greenStats || {};
    lines.push(
      `Green stats (profile): walks ${gs.totalWalks ?? 0} · calories ${gs.totalCaloriesBurned ?? 0} · CO₂ saved ~${gs.totalCO2Saved ?? 0} g · Carbon credits: ${act.carbonCredits ?? 0} · Social points: ${act.socialPoints ?? 0}`
    );
    if (act.weightKg != null && Number.isFinite(act.weightKg)) {
      lines.push(`Body weight on file (kg): ${act.weightKg} (used for calorie estimates)`);
    }
  }
  if (userProfileSnapshot && typeof userProfileSnapshot === 'object') {
    lines.push('');
    lines.push('FULL_USER_PROFILE_JSON (all available non-secret fields from database):');
    lines.push(JSON.stringify(userProfileSnapshot));
  }
  if (Array.isArray(userVisitsSnapshot) && userVisitsSnapshot.length) {
    lines.push('');
    lines.push('FULL_USER_VISITS_JSON (visit records for this user):');
    lines.push(JSON.stringify(userVisitsSnapshot));
  }
  if (
    parsedIntent &&
    (parsedIntent.goalSignals?.length ||
      parsedIntent.vibeSignals?.length ||
      parsedIntent.timeSignals?.length ||
      parsedIntent.currencyMentions?.length)
  ) {
    lines.push('');
    lines.push(
      `PARSED_INTENT (server extraction — align picks): goals=[${parsedIntent.goalSignals.join(', ')}] vibes=[${parsedIntent.vibeSignals.join(', ')}] times=[${parsedIntent.timeSignals.join(', ')}] currencies=[${parsedIntent.currencyMentions.join(', ')}] zeroSpend=${parsedIntent.zeroSpend} maxInr=${parsedIntent.budgetMaxRupees ?? 'n/a'} anchor=GPS ~${Number.isFinite(Number(explorationRadiusM)) && Number(explorationRadiusM) >= 200 ? Math.round(Number(explorationRadiusM) / 1000) : 12}km`
    );
    lines.push('USER_REQUIREMENT_INTENT_JSON (advanced NLP extraction; use this as the user requirement contract):');
    lines.push(JSON.stringify(parsedIntent));
  }
  if (emotionSignals && (emotionSignals.current?.length || emotionSignals.recent?.length)) {
    lines.push('');
    lines.push(
      `EMOTION_CONTEXT (dynamic user mood): current=[${(emotionSignals.current || []).join(', ')}] recent=[${(emotionSignals.recent || []).join(', ')}] primary=${emotionSignals.primary || 'unknown'} moodShift=${Boolean(emotionSignals.dynamicShift)}`
    );
    lines.push(
      'EMPATHY_RULES: Acknowledge the mood briefly, adapt suggestions to that feeling, and keep responses supportive. If moodShift=true, treat the latest mood as priority while still respecting recent context.'
    );
  }
  if (meetupSafety) {
    lines.push(
      'Meetup safety: prefer Red Pin merchants and/or busier public squares (higher footfall / crowdLevel on merchants). For late-night questions, give cautious practical tips—do not invent crime data.'
    );
  }
  if (mentionsLateNight(rawMessage)) {
    lines.push('User asked about night / safety: be careful and general; suggest well-lit busy areas and official guidance.');
  }
  if (greenMode || mentionsGreenCarbonQuestion(rawMessage)) {
    lines.push(
      'Green / walking: User cares about walking, carbon credits, or plastic-free choices. Prefer Red Pin merchants with ecoSnippet flags (plastic-free, solar, zero-waste) when recommending food or shops. Prefer nearby clusters walkable in sequence. You may describe indicative CO₂ avoided vs driving using only WEATHER_NOW / walk distance context—do not invent exact Carbon Credit ledger numbers; say the app logs credits on qualifying walks in Green Mode.'
    );
  }
  lines.push('');
  lines.push('ADVANCED_REQUIREMENT_RULES: Infer the user requirement from USER_REQUIREMENT_INTENT_JSON, not only literal words. Example: "find a quiet cafe" means cafe/coffee + low crowd + peaceful/work-study vibe + nearby + profile preferences. Rank with exact data first, then explain briefly why the top picks fit.');
  lines.push('DATA_TRUST_RULES: GoOut LOCAL_MERCHANTS/menu/prices are trusted first. Google/OSM PUBLIC_SPACES are external context and may be incomplete. Never invent a menu item, price, opening status, phone, rating, or place detail that is not in the JSON.');
  lines.push('PRICE_AND_MENU_RULES: menuItems/menuCatalogSnippet/menuPriceRange are real merchant-provided menu context when present. If absent, use avgPrice only as typical spend and say menu details are not available when asked.');
  lines.push('');
  lines.push('LOCAL_MERCHANTS (only these; prefer Red Pin over unnamed global chains when both fit "coffee" etc.):');
  if (!merchants.length) lines.push('(none in retrieved radius)');
  else {
    merchants.forEach((m, i) => {
      const pin = m.redPin ? ' RedPin' : '';
      const free = m.isFree ? ' FREE' : '';
      const gi = (m.greenInitiatives || []).length ? ` | green:${(m.greenInitiatives || []).join(';')}` : '';
      const eco = m.ecoSnippet ? ` | eco:${m.ecoSnippet}` : '';
      const tg = (m.tags || []).length ? ` | tags:${(m.tags || []).join(';')}` : '';
      const d = m.distanceMeters != null ? ` ~${m.distanceMeters}m` : '';
      const desc = m.descriptionSnippet ? ` | ${m.descriptionSnippet}` : '';
      const hrs = m.openingHoursLine ? ` | hours:${m.openingHoursLine}` : '';
      const menu = m.menuItems?.length ?
        ` | menu:${m.menuItems.slice(0, 5).map((it) => `${it.name} ₹${it.price}`).join('; ')}` :
        '';
      const menuRange = m.menuPriceRange ? ` | menuRange:${m.menuPriceRange}` : '';
      lines.push(
        `${i + 1}. id=${m.id} | ${m.name} | ${m.category} | ₹${m.avgPrice} avg | ★${Number(m.rating || 0).toFixed(1)} | crowd~${m.crowdLevel}${d}${pin}${free}${tg}${gi}${eco}${hrs}${menuRange}${menu}${desc}`
      );
    });
  }
  if (liveFlashOffers.length) {
    lines.push('');
    lines.push('LIVE_FLASH_DEALS (active offers tied to merchants above; times in UTC):');
    liveFlashOffers.forEach((o, i) => {
      lines.push(
        `${i + 1}. businessId=${o.businessId} | ${o.merchantName} | ${o.title} | ₹${o.offerPrice} | until ${o.validUntilIso}`
      );
    });
  }
  lines.push('');
  lines.push('PUBLIC_SPACES (only these names/coords):');
  if (!publicFetchAttempted) {
    lines.push('(not loaded this turn — ignore for food/shop questions; do not apologize for missing parks.)');
  } else if (!publicPlaces.length) {
    lines.push('(none returned — OK; still use LOCAL_MERCHANTS above unless the user only asked for parks.)');
  } else {
    publicPlaces.forEach((p, i) => {
      const d = p.distanceMeters != null ? ` ~${p.distanceMeters}m` : '';
      const rating = p.rating != null ? ` | ★${Number(p.rating || 0).toFixed(1)} (${p.ratingCount || 0})` : '';
      const price = p.priceLevel ? ` | priceLevel:${p.priceLevel}` : '';
      const addr = p.address ? ` | ${String(p.address).slice(0, 120)}` : '';
      const summary = p.editorialSummary ? ` | ${String(p.editorialSummary).slice(0, 160)}` : '';
      lines.push(`${i + 1}. ${p.name} | ${p.category} | ${p.lat},${p.lng}${d}${rating}${price}${addr}${summary}`);
    });
  }
  if (mapPois.length) {
    lines.push('');
    lines.push('MAP_POIS (Explorer search / blue pins on the user map — not GoOut-registered merchants):');
    mapPois.forEach((p, i) => {
      const d = p.distanceMeters != null ? ` ~${p.distanceMeters}m` : '';
      lines.push(`${i + 1}. ${p.name} | ${p.category} | ${p.lat},${p.lng}${d}`);
    });
  }
  lines.push('');
  lines.push('FULL_LOCAL_BUSINESSES_JSON (complete local merchant payload in this radius):');
  lines.push(JSON.stringify(merchants));
  lines.push('');
  lines.push('FULL_PUBLIC_PLACES_JSON (complete public place payload near this pin):');
  lines.push(JSON.stringify(publicPlaces));
  if (mapPois.length) {
    lines.push('');
    lines.push('FULL_MAP_POIS_JSON (all explorer map POI rows from client context):');
    lines.push(JSON.stringify(mapPois));
  }
  if (walkingAppendix) lines.push(walkingAppendix);
  return lines.join('\n');
}

const JSON_SCHEMA_HINT = `Reply with ONLY one JSON object (no markdown), shape:
{"reply":"string","browseIntent":"disambiguate"|"local"|"public"|"both"|"none","mapPan":null|{"lat":number,"lng":number},"highlightBusinessId":null|string,"walkDistanceMeters":null|number,"carbonCreditsNudge":null|string}

browseIntent (required):
- "none" — greeting/thanks, identity-only, or out-of-scope; no browse UI.
- "disambiguate" — vague "nearby" with both lists.
- "local" — GoOut merchants focus (bookstores, tailors, cafes, gifts, flash deals).
- "public" — parks, libraries, plazas, monuments, museums from PUBLIC_SPACES.
- "both" — hybrid itinerary (walk + local stops, park + cafe, etc.).

Rules: Only venues from lists. If LOCAL_MERCHANTS has rows, recommend at least one by name for shop/food/gift/sustainability/flash-deal questions — never only apologize about empty parks.
Hybrid: when both lists have rows, outline ordered steps (e.g. park → cafe). If PUBLIC_SPACES is thin, still deliver a strong local plan.
For "three shops + monument": pick up to three distinct merchants and one public row by name. mapPan = best preview pin.`;

const CONCIERGE_POLICIES = `
SCOPE & HONESTY:
- Data is ONLY for the user's current map coordinates (listed rows). Other cities or venues not in the lists: say clearly you have no GoOut data there—never invent businesses or parks.
- Decline car/home purchases and other non-local-commerce topics; redirect to map discovery.

HYBRID_RAG & LIVE CONTEXT:
- Private tier: LOCAL_MERCHANTS from MongoDB (Red Pin, tags, greenInitiatives, crowdLevel, verification). Public tier: PUBLIC_SPACES / MAP_POIS from geodata/Places-style APIs.
- LIVE_MAP_CONTEXT lines describe the Explorer client snapshot (pins + flash offers) at send time; crowd and deals reflect Socket-updated state on the device before the request — treat as current for recommendations.
- USER_REQUIREMENT_INTENT_JSON is the server NLP read of the message. Treat it as a planning layer: convert vague asks into practical constraints (quiet = low crowd + peaceful categories + study/work tags; date = cozy + safety + quality; budget = price/menu fit; green = walkable + eco signals).
- For menu/price asks, use merchant-provided menuItems/menuCatalogSnippet/menuPriceRange before avgPrice. If those fields are missing, say menu details are not available for that place instead of guessing.

LOCAL_FIRST & VALUE:
- Prefer independent / Red Pin / strong local signals over generic global chains when fit is comparable. For "cheaper vs better" questions, weigh walk time, vibe, and green credits qualitatively — do not invent exact rupee comparisons unless budget math is already in the prompt.
- Rank like a premium concierge: user requirement fit first, then profile preferences, menu/budget match, safety/Red Pin, rating/quality, distance, and green value. Mention 1-2 strongest reasons per pick.

BUDDY & DM PRIVACY:
- You never relay Buddy chat transcripts, phone numbers, emails, or home addresses. Meetups only at named Red Pin merchants or named public plazas/parks from the lists. Tell users to keep personal contact details in-app until they consciously agree to meet offline.

RED PIN & "SAFE" MEETUPS:
- Red Pin = GoOut local verification (identity + locality checks). If the user says "Safe Space" or "verified for meetup", treat Red Pin merchants as the verified local tier—there is no separate Safe Space flag in the data.
- For buddy / first meetup: prefer Red Pin + higher crowdLevel as busier; pair with a public square from PUBLIC_SPACES when available.
- Never suggest meeting at a private home, apartment, hotel room, Airbnb, or unpublished residential address. Only Red Pin rows from LOCAL_MERCHANTS or named PUBLIC_SPACES / MAP_POIS (public plazas, parks, libraries, etc.).
- When you recommend a buddy-style meetup spot, add one explicit safety line, e.g. "For your safety, meet at [named Red Pin or public plaza] — busy, well-lit, and suitable for a first hello."
- If the user wants to find people to explore with (pottery, art walks, coffee crawls), say they can enable Buddy Mode on the Buddies page so nearby explorers with similar interests can see them; you do not have a live roster of individual users in this chat.

LOCAL DISCOVERY (bookstore, tailor, artisan, gift, cafe):
- Prefer independent local rows and Red Pin over generic chains when both match.
- Use tags, category, descriptionSnippet for "handmade", "independent", "sustainable bookstore", etc.

SUSTAINABILITY RATING:
- There is no numeric "sustainability score" in JSON—use greenInitiatives + tags + localKarmaScore as proxies; say that explicitly. Quote greenInitiatives text when listing "most sustainable".

FLASH DEALS:
- When LIVE_FLASH_DEALS is non-empty, you may say which merchant has an active offer only if validUntilIso is after SERVER UTC (see TEMPORAL_RULES). If the user asks for flash deals and the section is empty, say no active flash deals in the current listings.

PUBLIC / LANDMARKS:
- PUBLIC_SPACES may include parks, gardens, libraries, attractions from OSM/Google text search—names are external data, not GoOut-verified.
- You cannot verify shade trees, bench count, indoor quiet, or "open right now" for public buildings—give best-effort picks from names/categories and advise checking locally.
- Libraries / museums / monuments: choose closest rows that semantically match the ask.

HYBRID ITINERARIES & ROUTES:
- Morning / 2h / walking tour: sequence public then local (or vice versa) using only listed rows; mention straight-line proximity; walking route hints may appear in WALKING_ROUTE lines—use them.

BUDGET & MULTI-STOP:
- avgPrice is INR typical spend per visit, not a bill guarantee. For "$15 total" style asks, combine low avgPrice merchants + free public rows so the plan plausibly fits.
- "$" cheap tier: steer to lowest avgPrice in list. Zero-spend: only FREE merchants + free public.
- If the user wants an itinerary under a cap, sum only listed avgPrice (INR) for merchants you name plus ₹0 for public rows; say when you are unsure and round conservatively.
- Pay-to-stay: suggest a small purchase at a local Red Pin then a free nearby park/square from PUBLIC_SPACES — walking between them saves money and pairs with Green Mode walk credits qualitatively.
- If a merchant is slightly over budget but clearly more sustainable (greenInitiatives / tags), you may explain the tradeoff in one sentence — do not invent exact rupee savings.

GREEN / CARBON:
- Do not invent exact Carbon Credit amounts. Encourage walking between nearby pins; Green Mode in the app logs credits on qualifying walks (qualitative only here).

FEEDBACK & RATINGS:
- You cannot change Red Pin or ratings yourself. When relevant, mention that quick post-visit feedback in the app helps the community and merchants.

OPENING HOURS:
- Merchant "hours" fields are owner text—cannot confirm live open/closed.

NIGHT SAFETY:
- Practical, non-alarmist tips; no crime stats; suggest lit, busier areas and Red Pin / higher footfall where relevant.

WHO YOU ARE (if asked):
- GoOut City Concierge: hyper-local discovery on this map—merchants, deals, parks, budgets, meetups—not general web search.
`.trim();

const SYSTEM_BASE = `You are the GoOut City Concierge — a knowledgeable, friendly guide for the Explorer map.
${CONCIERGE_POLICIES}`;

const SYSTEM_GREETING = `${SYSTEM_BASE}
VOICE:
- Talk cool and real: short lines, natural phrasing, no corporate tone.
- Keep it brief: 1-2 sentences max for greetings.
The user sent a short greeting or thanks. Set browseIntent to "none".
${JSON_SCHEMA_HINT}`;

function conciergeUserIdentityInstruction(displayName) {
  const n = String(displayName || '')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, 80);
  if (!n) return '';
  return `

USER_IDENTITY: The user is signed in. Their display name is "${n}". Address them by this name when it feels natural (e.g. greetings, thanks, or a warm close)—do not repeat their name in every sentence.`;
}

const SYSTEM_FULL = `${SYSTEM_BASE}
Answer using ONLY the supplied lists. LOCAL_MERCHANTS and PUBLIC_SPACES are independent: many pins have merchants but no park rows.
If LOCAL_MERCHANTS is non-empty, base your answer on it for food, cafés, shops, prices, Red Pin, sustainability tags, and generic "nearby" questions — even when PUBLIC_SPACES is empty or "(not loaded)".
Mention missing parks only when the user explicitly wanted parks/outdoors or a park+shop itinerary and public data is empty; then suggest locals plus moving the map for parks.
NATURAL_GUIDE: Sound like a friendly local — concise, warm, and actionable. When MAP_POIS, PUBLIC_SPACES, and LOCAL_MERCHANTS all contribute, weave one short story (e.g. grab tea at [merchant] then walk a few minutes to [park/bench POI]) using exact names from the lists and straight-line distances when walk times are not in WALKING_ROUTE lines.
VOICE:
- Talk cool and real. Use plain words, contractions, and short punchy lines.
- Keep replies tight: usually 2-5 lines. Skip fluff and repetitive caveats.
- Be confident but honest. If data is missing, say it once and move to useful picks.
LANGUAGE_ADAPTATION: Mirror the user's style (simple, casual, Hinglish-like phrases, or formal) while staying clear and respectful. Understand short/slang asks and map them to nearby intents.
NLP_REQUIREMENT_UNDERSTANDING: Understand intent behind casual language, typos, mixed English/Hinglish, and short commands. Do not require exact keywords. If the user says "quiet cafe", infer peaceful coffee place with lower crowd, possible laptop/study vibe, nearby distance, and any saved prefer/avoid profile rules.
EMOTION_INTELLIGENCE: Read emotional cues from the user text and EMOTION_CONTEXT. Support moods like bored, sad, happy, stressed, lonely, romantic, flirty/"hotty", angry, tired, and mixed moods. Keep tone safe and respectful; avoid explicit sexual content even if user is flirty.
HYBRID_QUESTIONS: If user asks combinations (e.g. "coffee + park", "shop and monument", "food then walk"), always provide a combined plan with sequence, route hint, and why each stop fits.
ROUTE_FIRST: When route hints exist (WALKING_ROUTE / HYBRID_ROUTE_HINT), include them naturally in the answer.
When USER_ACTIVITY appears in context, you may reference that user’s logged walks, calories, CO₂ and carbon credits naturally — never invent numbers beyond what is printed there.
${JSON_SCHEMA_HINT}`;

const SYSTEM_COMPACT = `You are GoOut City Concierge.
Use only provided lists. Do not invent places.
Tone: cool, real, concise.
Return only JSON with fields: reply,browseIntent,mapPan,highlightBusinessId,walkDistanceMeters,carbonCreditsNudge.`;

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

function toGeminiHistory(history) {
  const out = [];
  const arr = Array.isArray(history) ? history.slice(-18) : [];
  for (const h of arr) {
    const role = h.role === 'assistant' ? 'model' : 'user';
    const text = String(h.content || '').trim();
    if (!text) continue;
    out.push({ role, parts: [{ text }] });
  }
  return out;
}


function buildOfflineConciergeParsed({
  message,
  casualGreeting,
  merchantPayload,
  publicPayload,
  userLat,
  userLng,
  greenMode,
  mapPoiCount = 0,
  userDisplayName = null
}) {
  const offlineNotice = 'This function is currently not available.';
  if (casualGreeting) {
    const first =
      typeof userDisplayName === 'string' && userDisplayName.trim() ?
        userDisplayName.trim().split(/\s+/)[0] :
        '';
    const hey = first ? `Hey ${first}! ` : 'Hey! ';
    const hasPins = merchantPayload.length > 0;
    return {
      reply: hasPins ?
        `${hey}${offlineNotice} You still have ${merchantPayload.length} nearby GoOut spots on map — tap a pin and go.` :
        `${hey}${offlineNotice} This pin has no nearby GoOut spots. Move the map a bit or zoom out.`,
      browseIntent: 'none',
      mapPan: null,
      highlightBusinessId: null,
      walkDistanceMeters: null,
      carbonCreditsNudge: null
    };
  }

  const top = merchantPayload.find((m) => m.redPin) || merchantPayload[0];
  const list = merchantPayload.slice(0, 8);
  const bullets = list
    .map(
      (m, i) =>
        `${i + 1}. ${m.name} (${m.category})${m.redPin ? ' — Red Pin' : ''}${
          m.distanceMeters != null ? `, ~${m.distanceMeters}m` : ''
        } · ~₹${m.avgPrice} avg`
    )
    .join('\n');

  let reply = '';
  if (list.length) {
    reply = `${offlineNotice} Nearby GoOut picks are still here:\n${bullets}`;
  } else if (publicPayload.length) {
    reply = `${offlineNotice} No GoOut merchants in this radius, but nearby public spots are:\n${publicPayload
      .slice(0, 6)
      .map((p, i) => `${i + 1}. ${p.name} (${p.category})`)
      .join('\n')}`;
  } else {
    reply = `${offlineNotice} This radius is empty. Zoom out or move the pin, then ask again.`;
  }
  if (publicPayload.length && list.length) {
    reply += `\n\nPublic picks nearby: ${publicPayload
      .slice(0, 4)
      .map((p) => p.name)
      .join('; ')}.`;
  }

  let mapPan = null;
  let highlightBusinessId = null;
  let walkDistanceMeters = null;
  if (top && Number.isFinite(top.lat) && Number.isFinite(top.lng)) {
    mapPan = { lat: top.lat, lng: top.lng };
    highlightBusinessId = top.id;
    walkDistanceMeters =
      top.distanceMeters != null ?
        top.distanceMeters :
        Math.round(haversineMeters(userLat, userLng, top.lat, top.lng));
  } else if (!list.length && publicPayload[0] && Number.isFinite(publicPayload[0].lat) && Number.isFinite(publicPayload[0].lng)) {
    const p0 = publicPayload[0];
    mapPan = { lat: p0.lat, lng: p0.lng };
    walkDistanceMeters =
      p0.distanceMeters != null ?
        p0.distanceMeters :
        Math.round(haversineMeters(userLat, userLng, p0.lat, p0.lng));
  }

  let carbonCreditsNudge = null;
  if (greenMode && walkDistanceMeters != null && walkDistanceMeters < 1000) {
    carbonCreditsNudge = `About ${walkDistanceMeters}m — walk in Green Mode to log Carbon Credits.`;
  }

  return {
    reply,
    browseIntent: inferBrowseIntent(
      message,
      false,
      merchantPayload.length,
      publicPayload.length + (mapPoiCount || 0)
    ),
    mapPan,
    highlightBusinessId,
    walkDistanceMeters,
    carbonCreditsNudge
  };
}

export async function runConciergeChat({
  message,
  lat,
  lng,
  history = [],
  greenMode = false,
  mapContext = null,
  userId = null,
  discoveryPreferences = null,
  userInterests = [],
  userDisplayName = null,
  explorationRadiusM = null,
  userActivitySnapshot = null,
  userProfileSnapshot = null,
  userVisitsSnapshot = []
}) {
  const userLat = Number(lat);
  const userLng = Number(lng);
  const rawMessage = String(message || '').trim();
  if (!rawMessage) {
    return { error: 'Message is required', status: 400 };
  }
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
    return { error: 'Valid lat and lng are required', status: 400 };
  }

  if (userId) {
    const prefQuick = await tryApplyPreferenceCommand(rawMessage, userId);
    if (prefQuick) return prefQuick;
  }

  const budget = parseBudgetContext(rawMessage);
  const meetupSafety = isMeetupIntent(rawMessage);
  const searchHint = extractSearchHint(rawMessage);
  const parsedIntent = parseIntentSummary(rawMessage, budget, searchHint);
  const emotionSignals = extractEmotionSignals(rawMessage, history);
  const casualGreeting = isCasualGreeting(rawMessage);

  const er = Number(explorationRadiusM);
  const maxMerchantRadiusM =
    Number.isFinite(er) && er >= 200 && er <= 50000 ? Math.round(er) : 12000;

  const coords = [userLng, userLat];
  let merchantQuery = {
    location: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: coords },
        $maxDistance: maxMerchantRadiusM
      }
    }
  };

  const r = searchHint ? buildOrRegexFromQuery(searchHint) : null;
  if (r) {
    merchantQuery.$or = [{ category: r }, { name: r }, { tags: r }];
  }

  const merchantFindLimit = casualGreeting ? 24 : 80;
  let merchants = await Business.find(merchantQuery).limit(merchantFindLimit).lean();
  merchants = applyLocalPrioritySorting(merchants);

  const hadTextFilter = Boolean(r);
  if (merchants.length === 0 && hadTextFilter && isShortDiscoveryMessage(rawMessage, searchHint)) {
    const geoOnly = {
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: coords },
          $maxDistance: Math.max(maxMerchantRadiusM, 35000)
        }
      }
    };
    let geoList = await Business.find(geoOnly).limit(100).lean();
    geoList = applyLocalPrioritySorting(geoList);
    merchants = rankMerchantsByHint(geoList, searchHint || rawMessage);
  }

  if (merchants.length === 0) {
    const wide = {
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: coords },
          $maxDistance: 75000
        }
      }
    };
    const wideList = await Business.find(wide).limit(45).lean();
    merchants = rankMerchantsByHint(applyLocalPrioritySorting(wideList), searchHint || rawMessage);
  }

  const merchantsBeforeBudgetFilter = [...merchants];
  let budgetMatchedMerchantCount = merchants.length;
  let budgetFallbackUsed = false;
  if (budget.isZeroSpend) {
    const filtered = merchants.filter((b) => b.isFree === true || (b.avgPrice ?? 0) <= 0);
    budgetMatchedMerchantCount = filtered.length;
    if (filtered.length > 0 || merchantsBeforeBudgetFilter.length === 0) {
      merchants = filtered;
    } else {
      // Keep local knowledge visible when strict budget yields no exact local matches.
      merchants = merchantsBeforeBudgetFilter;
      budgetFallbackUsed = true;
    }
  } else if (budget.maxInr != null && budget.maxInr > 0) {
    const filtered = merchants.filter((b) => (b.avgPrice ?? 0) <= budget.maxInr);
    budgetMatchedMerchantCount = filtered.length;
    if (filtered.length > 0 || merchantsBeforeBudgetFilter.length === 0) {
      merchants = filtered;
    } else {
      // Keep local knowledge visible when strict budget yields no exact local matches.
      merchants = merchantsBeforeBudgetFilter;
      budgetFallbackUsed = true;
    }
  }

  if (/\b(highest|most|rank|best|top)\b.*\b(sustain|green|eco)|sustainability\s+rating\b/i.test(rawMessage)) {
    merchants = [...merchants].sort((a, b) => {
      const ecoTags = (tags) =>
        (Array.isArray(tags) ? tags : []).filter((t) => SUSTAIN_HINTS.test(String(t))).length;
      const ga =
        (Array.isArray(a.greenInitiatives) ? a.greenInitiatives.length : 0) + ecoTags(a.tags);
      const gb =
        (Array.isArray(b.greenInitiatives) ? b.greenInitiatives.length : 0) + ecoTags(b.tags);
      if (gb !== ga) return gb - ga;
      return (b.localKarmaScore || 0) - (a.localKarmaScore || 0);
    });
  }

  if (meetupSafety) {
    const safe = merchants.filter(
      (b) => b?.localVerification?.redPin || Number(b?.crowdLevel ?? 0) >= 42
    );
    if (safe.length > 0) merchants = safe;
  }

  let flashOfferDocs = [];
  if (!casualGreeting) {
    try {
      flashOfferDocs = await fetchFlashOffersNear(coords, maxMerchantRadiusM);
    } catch (e) {
      console.error('[concierge] flash offers near', e);
    }
    const flashBizIds = new Set(
      flashOfferDocs.map((o) => String(o.businessId?._id || o.businessId))
    );
    if (wantsFlashDealPriority(rawMessage) && flashBizIds.size && merchants.length) {
      merchants = [...merchants].sort((a, b) => {
        const af = flashBizIds.has(String(a._id)) ? 1 : 0;
        const bf = flashBizIds.has(String(b._id)) ? 1 : 0;
        if (bf !== af) return bf - af;
        const ar = a?.localVerification?.redPin ? 1 : 0;
        const br = b?.localVerification?.redPin ? 1 : 0;
        if (br !== ar) return br - ar;
        return (b.localKarmaScore || 0) - (a.localKarmaScore || 0);
      });
    }
  }

  if (greenMode && !casualGreeting && merchants.length > 1) {
    merchants = [...merchants].sort((a, b) => {
      const d = ecoConciergeRank(b) - ecoConciergeRank(a);
      if (d !== 0) return d;
      const aRed = a?.localVerification?.redPin ? 1 : 0;
      const bRed = b?.localVerification?.redPin ? 1 : 0;
      if (bRed !== aRed) return bRed - aRed;
      return (Number(b.localKarmaScore) || 0) - (Number(a.localKarmaScore) || 0);
    });
  }

  merchants = merchants.slice(0, casualGreeting ? 16 : 48);

  let liveFlashOffersForPrompt = flashOfferDocs.map((o) => ({
    businessId: String(o.businessId?._id || o.businessId),
    merchantName: String(o.businessId?.name || 'Merchant'),
    title: String(o.title || ''),
    offerPrice: o.offerPrice ?? 0,
    validUntilIso: o.validUntil ? new Date(o.validUntil).toISOString() : ''
  })).slice(0, 28);

  const publicFetchAttempted = !casualGreeting;
  let publicSpaces = [];
  if (publicFetchAttempted) {
    try {
      const publicRadius = Math.min(maxMerchantRadiusM, 25000);
      publicSpaces = await fetchPublicSpacesNear(userLat, userLng, publicRadius, rawMessage, {
        maxResults: 80,
        detailsCap: 8
      });
    } catch (e) {
      console.error('[concierge] public spaces', e);
    }
  }

  const mapMc = sanitizeMapContext(mapContext);
  let mapPoisPayload = (mapMc?.pois || [])
    .map((p) => serializeMapContextPoi(p, userLat, userLng))
    .filter(Boolean);

  const merchantPayloadBase = merchants.map((b) => serializeMerchant(b, userLat, userLng));
  let merchantPayload = mergeMerchantsWithMapContext(merchantPayloadBase, mapContext, userLat, userLng);
  const hasExplorerMapMerchants = Boolean(mapMc?.businesses?.length);

  liveFlashOffersForPrompt = mergeMapContextFlashOffers(
    liveFlashOffersForPrompt,
    mapMc?.offers,
    merchantPayload
  );

  let publicPayload = publicSpaces.map(serializePublic);
  const moodOrderedPayload = applyMoodAwareOrdering({
    merchants: merchantPayload,
    publicRows: publicPayload,
    mapPois: mapPoisPayload,
    emotionSignals
  });
  merchantPayload = moodOrderedPayload.merchants;
  publicPayload = moodOrderedPayload.publicRows;
  mapPoisPayload = moodOrderedPayload.mapPois;

  const profileOrderedPayload = buildProfileAwareOrdering({
    merchants: merchantPayload,
    publicRows: publicPayload,
    mapPois: mapPoisPayload,
    discoveryPreferences,
    userInterests,
    rawMessage,
    searchHint
  });
  merchantPayload = profileOrderedPayload.merchants;
  publicPayload = profileOrderedPayload.publicRows;
  mapPoisPayload = profileOrderedPayload.mapPois;

  const requirementOrderedPayload = applyRequirementAwareOrdering({
    merchants: merchantPayload,
    publicRows: publicPayload,
    mapPois: mapPoisPayload,
    parsedIntent,
    budget,
    discoveryPreferences,
    userInterests
  });
  merchantPayload = requirementOrderedPayload.merchants;
  publicPayload = requirementOrderedPayload.publicRows;
  mapPoisPayload = requirementOrderedPayload.mapPois;

  const dynamicNeedles = extractDynamicQueryNeedles(rawMessage, searchHint);
  if (!casualGreeting && dynamicNeedles.length > 0 && seemsPlaceDiscoveryAsk(rawMessage) && !isBudgetDominantQuery(rawMessage)) {
    const localMatches = merchantPayload.filter((m) => rowMatchesDynamicNeedles(m, dynamicNeedles));
    const publicMatches = [...publicPayload, ...mapPoisPayload].filter((p) => rowMatchesDynamicNeedles(p, dynamicNeedles));
    if (localMatches.length === 0 && publicMatches.length === 0) {
      const nearest =
        merchantPayload.find((m) => Number.isFinite(m?.lat) && Number.isFinite(m?.lng)) ||
        [...publicPayload, ...mapPoisPayload].find((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) ||
        null;
      const mapPan = nearest ? { lat: Number(nearest.lat), lng: Number(nearest.lng) } : null;
      const walkDistanceMeters =
        nearest && Number.isFinite(userLat) && Number.isFinite(userLng) ?
          Math.round(haversineMeters(userLat, userLng, Number(nearest.lat), Number(nearest.lng))) :
          null;
      return {
        reply: buildNoExactMatchReply(rawMessage, merchantPayload, publicPayload, mapPoisPayload),
        mapPan,
        highlightBusinessId: null,
        walkDistanceMeters,
        carbonCreditsNudge: null,
        nearby: {
          local: merchantPayload.slice(0, 60),
          public: publicPayload.slice(0, 60),
          mapPois: mapPoisPayload.slice(0, 60)
        },
        meta: {
          budgetMaxRupees: budget.maxInr,
          budgetNote: budget.note,
          isZeroSpend: budget.isZeroSpend,
          meetupSafety,
          greenMode,
          merchantCount: merchantPayload.length,
          publicSpaceCount: publicPayload.length,
          mapPoiCount: mapPoisPayload.length,
          mapExplorer: {
            merchantsFromClient: mapMc?.businesses?.length || 0,
            poisFromClient: mapPoisPayload.length,
            offersFromClient: mapMc?.offers?.length || 0
          },
          geminiModel: null,
          offline: false,
          browseIntent: merchantPayload.length && (publicPayload.length || mapPoisPayload.length) ? 'both' : merchantPayload.length ? 'local' : 'public',
          parsedIntent,
          dynamicQueryGuardNoMatch: true
        }
      };
    }
  }

  if (!casualGreeting && isOutOfScopePurchase(rawMessage)) {
    const browseIntent = 'none';
    const NEARBY_LIST_CAP = 60;
    return {
      reply:
        'I am GoOut’s City Concierge for nearby cafés, parks, meetups, and local shops on your map—not for buying cars, homes, or other big purchases. Ask me about Red Pin merchants, flash deals, public squares, budgets, or walking routes between places in your list.',
      mapPan: null,
      highlightBusinessId: null,
      walkDistanceMeters: null,
      carbonCreditsNudge: null,
      nearby: {
        local: merchantPayload.slice(0, NEARBY_LIST_CAP),
        public: publicPayload.slice(0, NEARBY_LIST_CAP),
        mapPois: mapPoisPayload.slice(0, NEARBY_LIST_CAP)
      },
      meta: {
        budgetMaxRupees: budget.maxInr,
        budgetNote: budget.note,
        isZeroSpend: budget.isZeroSpend,
        meetupSafety,
        greenMode,
        merchantCount: merchantPayload.length,
        publicSpaceCount: publicPayload.length,
        mapPoiCount: mapPoisPayload.length,
        mapExplorer: {
          merchantsFromClient: mapMc?.businesses?.length || 0,
          poisFromClient: mapPoisPayload.length,
          offersFromClient: mapMc?.offers?.length || 0
        },
        geminiModel: null,
        offline: false,
        browseIntent,
        outOfScope: true,
        parsedIntent
      }
    };
  }

  const genAI = createGeminiClient(GEMINI_KEY_SCOPES.CHATBOT);
  if (!genAI) {
    const offlineParsed = buildOfflineConciergeParsed({
      message: rawMessage,
      casualGreeting,
      merchantPayload,
      publicPayload,
      userLat,
      userLng,
      greenMode,
      mapPoiCount: mapPoisPayload.length,
      userDisplayName
    });
    const browseIntent = resolveBrowseIntent({
      modelIntent: offlineParsed.browseIntent,
      message: rawMessage,
      casualGreeting,
      localLen: merchantPayload.length,
      publicLen: publicPayload.length + mapPoisPayload.length
    });
    const NEARBY_LIST_CAP = 60;
    return {
      reply: String(offlineParsed.reply || '').trim(),
      mapPan: offlineParsed.mapPan || null,
      highlightBusinessId: offlineParsed.highlightBusinessId || null,
      walkDistanceMeters: offlineParsed.walkDistanceMeters ?? null,
      carbonCreditsNudge: offlineParsed.carbonCreditsNudge || null,
      nearby: {
        local: merchantPayload.slice(0, NEARBY_LIST_CAP),
        public: publicPayload.slice(0, NEARBY_LIST_CAP),
        mapPois: mapPoisPayload.slice(0, NEARBY_LIST_CAP)
      },
      meta: {
        budgetMaxRupees: budget.maxInr,
        budgetNote: budget.note,
        isZeroSpend: budget.isZeroSpend,
        meetupSafety,
        greenMode,
        merchantCount: merchantPayload.length,
        publicSpaceCount: publicPayload.length,
        mapPoiCount: mapPoisPayload.length,
        mapExplorer: {
          merchantsFromClient: mapMc?.businesses?.length || 0,
          poisFromClient: mapPoisPayload.length,
          offersFromClient: mapMc?.offers?.length || 0
        },
        geminiModel: null,
        offline: true,
        browseIntent,
        parsedIntent,
        geminiError: 'Missing GEMINI_API_KEY'
      }
    };
  }

  const modelId = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  const forPromptMerchants = casualGreeting ? merchantPayload.slice(0, 48) : merchantPayload;
  const forPromptPublic = casualGreeting ? [] : publicPayload;
  const forPromptPublicWithMapPois = [...forPromptPublic, ...mapPoisPayload];

  const walkingAppendix = casualGreeting ?
    '' :
    await buildWalkingDirectionsAppendix(rawMessage, forPromptMerchants, forPromptPublicWithMapPois);
  const hybridAppendix = casualGreeting ?
    '' :
    await buildAutoHybridRouteAppendix(rawMessage, forPromptMerchants, forPromptPublicWithMapPois);

  let weatherNote = '';
  if (greenMode && !casualGreeting) {
    weatherNote = (await fetchOpenMeteoBrief(userLat, userLng)) || '';
  }

  const contextNotes = [];
  if (budgetFallbackUsed) {
    contextNotes.push(
      `Budget filter note: no exact local merchant matched the strict cap (${budget.isZeroSpend ? '₹0/free only' : `≤₹${budget.maxInr}`}) in this radius. Use closest local alternatives from LOCAL_MERCHANTS and clearly mark them as over budget, while still suggesting free/public options.`
    );
  }
  if (mentionsNamedWorldCity(rawMessage)) {
    contextNotes.push(
      'NOTE: User may reference a distant city; all merchant/public rows are ONLY near their current map coordinates—say that explicitly if needed.'
    );
  }
  if (isIdentityMetaQuery(rawMessage)) {
    contextNotes.push(
      'User asked who you are / what you can do: explain you are the GoOut City Concierge for Red Pin merchants, flash deals, budgets, public parks/libraries/plazas, walking ideas, and buddy meetup tips on their current map—not web search or purchases like cars/homes.'
    );
  }
  if (mentionsOpeningHoursQuestion(rawMessage)) {
    contextNotes.push(
      'Opening hours: the "hours" field on merchants is owner-supplied text; you cannot know live open/closed—advise confirming by phone or on-site.'
    );
  }

  const liveMapSyncLine = mapMc ?
    `LIVE_MAP_CONTEXT: Explorer snapshot with ${mapMc.businesses?.length || 0} merchant row(s), ${mapMc.pois?.length || 0} map POI(s), ${mapMc.offers?.length || 0} offer card(s) — crowdLevel and flash offers match the client view at send time.` :
    '';

  const sessionSignals = extractSessionSignalsFromHistory(history);

  const contextText = formatContextForPrompt(forPromptMerchants, forPromptPublic, {
    userLat,
    userLng,
    budget,
    meetupSafety,
    greenMode,
    serverIso: new Date().toISOString(),
    walkingAppendix: `${walkingAppendix || ''}${hybridAppendix || ''}`,
    contextNotes,
    rawMessage,
    publicFetchAttempted,
    liveFlashOffers: liveFlashOffersForPrompt,
    mapPois: mapPoisPayload,
    hasExplorerMapMerchants,
    discoveryPreferences,
    userInterests,
    parsedIntent,
    emotionSignals,
    liveMapSyncLine,
    sessionSignals,
    explorationRadiusM: maxMerchantRadiusM,
    userActivitySnapshot,
    userProfileSnapshot,
    userVisitsSnapshot
  });

  let userBlock = `${contextText}\n\nUser message:\n${rawMessage}`;
  if (weatherNote) userBlock = `${weatherNote}\n\n${userBlock}`;
  if (greenMode && !casualGreeting) {
    userBlock +=
      '\n\nGREEN_MODE_STYLE: When suitable, add a one-line reusable cup/bag nudge for cafés or groceries. If the user chases a far-away mall or generic chain not listed but LOCAL_MERCHANTS has a closer walkable Red Pin or strong eco row, suggest that greener/local alternative once.';
  }

  const geminiHistory = toGeminiHistory(history);
  const contents = [...geminiHistory, { role: 'user', parts: [{ text: userBlock }] }];
  const compactContext = [
    `User location: ${userLat},${userLng}`,
    `Merchants: ${(forPromptMerchants || []).slice(0, 8).map((m) => `${m.name}|${m.category}|${m.distanceMeters ?? 'n/a'}m`).join('; ') || 'none'}`,
    `Public: ${(forPromptPublicWithMapPois || []).slice(0, 8).map((p) => `${p.name}|${p.category}|${p.distanceMeters ?? 'n/a'}m`).join('; ') || 'none'}`,
    !casualGreeting && liveFlashOffersForPrompt.length ?
      `Flash deals: ${liveFlashOffersForPrompt.slice(0, 8).map((o) => `${o.merchantName}:${o.title}|₹${o.offerPrice}`).join('; ')}` :
      null,
    `User: ${rawMessage}`
  ].
    filter(Boolean).
    join('\n');

  const nameBlock = conciergeUserIdentityInstruction(userDisplayName);
  const sharedModelOptions = {
    systemInstruction: (casualGreeting ? SYSTEM_GREETING : SYSTEM_FULL) + nameBlock,
    generationConfig: {
      temperature: casualGreeting ? 0.65 : 0.52,
      maxOutputTokens: casualGreeting ? 512 : 2048,
      responseMimeType: 'application/json'
    }
  };

  let textOut = '';
  let usedOffline = false;
  let geminiError = null;
  let usedModelId = null;

  const candidateModels = buildGeminiCandidateModels(modelId);
  for (const candidate of candidateModels) {
    try {
      const model = getGenerativeModelForModelId(genAI, candidate, sharedModelOptions);
      if (!model) continue;
      const result = await model.generateContent({ contents });
      textOut = result?.response?.text?.() || '';
      usedModelId = candidate;
      geminiError = null;
      break;
    } catch (e) {
      geminiError = e;
      console.error('[concierge] Gemini call failed:', candidate, e?.message || e);
      const kind = classifyGeminiError(e);
      if (kind === 'transient') {
        // Quick compact retry for transient 5xx on current candidate.
        try {
          const compactModel = getGenerativeModelForModelId(genAI, candidate, {
            systemInstruction: SYSTEM_COMPACT + nameBlock,
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 768,
              responseMimeType: 'application/json'
            }
          });
          if (compactModel) {
            const compactResult = await compactModel.generateContent({
              contents: [{ role: 'user', parts: [{ text: compactContext }] }]
            });
            textOut = compactResult?.response?.text?.() || '';
            if (textOut) {
              usedModelId = candidate;
              geminiError = null;
              break;
            }
          }
        } catch (compactErr) {
          geminiError = compactErr;
          console.error('[concierge] Gemini compact retry failed:', candidate, compactErr?.message || compactErr);
        }
        await sleepMs(250);
      }
    }
  }
  if (!textOut) usedOffline = true;

  let parsed = safeJsonParse(textOut);
  if (usedOffline || !parsed || typeof parsed.reply !== 'string') {
    if (!usedOffline && textOut) {
      console.warn('[concierge] JSON parse failed, model:', modelId, textOut.slice(0, 160));
    }
    parsed = buildOfflineConciergeParsed({
      message: rawMessage,
      casualGreeting,
      merchantPayload,
      publicPayload,
      userLat,
      userLng,
      greenMode,
      mapPoiCount: mapPoisPayload.length,
      userDisplayName
    });
    usedOffline = true;
  }

  if (typeof parsed.reply === 'string') {
    parsed.reply = repairReplyIfPublicOnlyApology(parsed.reply, merchantPayload, publicPayload, mapPoisPayload, budget);
    parsed.reply = ensureDiscoveryReplyContainsGroundedNames(rawMessage, parsed.reply, merchantPayload, publicPayload, mapPoisPayload);
  }

  let walkDistanceMeters =
    parsed.walkDistanceMeters != null && Number.isFinite(Number(parsed.walkDistanceMeters)) ?
      Math.round(Number(parsed.walkDistanceMeters)) :
      null;

  let carbonCreditsNudge =
    typeof parsed.carbonCreditsNudge === 'string' && parsed.carbonCreditsNudge.trim() ?
      parsed.carbonCreditsNudge.trim() :
      null;

  const mapPan =
    parsed.mapPan &&
    Number.isFinite(Number(parsed.mapPan.lat)) &&
    Number.isFinite(Number(parsed.mapPan.lng)) ?
      { lat: Number(parsed.mapPan.lat), lng: Number(parsed.mapPan.lng) } :
      null;

  if (mapPan && (walkDistanceMeters == null || !Number.isFinite(walkDistanceMeters))) {
    walkDistanceMeters = Math.round(haversineMeters(userLat, userLng, mapPan.lat, mapPan.lng));
  }

  if (
    (greenMode || (walkDistanceMeters != null && walkDistanceMeters < 1000)) &&
    walkDistanceMeters != null &&
    walkDistanceMeters < 1000 &&
    !carbonCreditsNudge
  ) {
    carbonCreditsNudge = `Only about ${walkDistanceMeters}m — walking this in GoOut Green earns Carbon Credits.`;
  }

  if (
    greenMode &&
    weatherNote &&
    /sunny|clear/i.test(weatherNote) &&
    walkDistanceMeters != null &&
    walkDistanceMeters > 80 &&
    walkDistanceMeters < 4000 &&
    !carbonCreditsNudge
  ) {
    carbonCreditsNudge = `Clear skies — a ${Math.round(walkDistanceMeters)}m walk is ideal; you skip parking stress and GoOut logs green credits when you arrive on foot.`;
  }

  const highlightBusinessId =
    parsed.highlightBusinessId && merchantPayload.some((m) => m.id === String(parsed.highlightBusinessId)) ?
      String(parsed.highlightBusinessId) :
      null;

  const browseIntent = resolveBrowseIntent({
    modelIntent: parsed.browseIntent,
    message: rawMessage,
    casualGreeting,
    localLen: merchantPayload.length,
    publicLen: publicPayload.length + mapPoisPayload.length
  });

  const NEARBY_LIST_CAP = 60;
  const nearby = {
    local: merchantPayload.slice(0, NEARBY_LIST_CAP),
    public: publicPayload.slice(0, NEARBY_LIST_CAP),
    mapPois: mapPoisPayload.slice(0, NEARBY_LIST_CAP)
  };

  const meta = {
    budgetMaxRupees: budget.maxInr,
    budgetNote: budget.note,
    isZeroSpend: budget.isZeroSpend,
    budgetMatchedMerchantCount,
    budgetFallbackUsed,
    meetupSafety,
    greenMode,
    merchantCount: merchantPayload.length,
    publicSpaceCount: publicPayload.length,
    mapPoiCount: mapPoisPayload.length,
    mapExplorer: {
      merchantsFromClient: mapMc?.businesses?.length || 0,
      poisFromClient: mapPoisPayload.length,
      offersFromClient: mapMc?.offers?.length || 0
    },
    personalization: {
      interestsCount: normalizeInterests(userInterests).length,
      preferCount: normalizeDiscoveryPreferences(discoveryPreferences).prefer.length,
      avoidCount: normalizeDiscoveryPreferences(discoveryPreferences).avoid.length,
      hasNotes: Boolean(normalizeDiscoveryPreferences(discoveryPreferences).notes)
    },
    geminiModel: usedOffline ? null : usedModelId || modelId,
    offline: usedOffline,
    browseIntent,
    parsedIntent,
    emotionSignals
  };

  if (geminiError && usedOffline) {
    meta.geminiError = String(geminiError?.message || geminiError).slice(0, 400);
  }

  return {
    reply: parsed.reply.trim(),
    mapPan,
    highlightBusinessId,
    walkDistanceMeters,
    carbonCreditsNudge,
    nearby,
    meta
  };
}
