/**
 * Heuristic cost–benefit scoring for local merchant comparison.
 * Costs: financial (₹), opportunity time (₹-equivalent), environmental penalty.
 * Benefits: sustainability, local/community, safe-space connectivity, incentive hints.
 */

const CHAIN_RE = /\b(starbucks|mcdonald|kfc|subway|domino|pizza hut|burger king|costa|dunkin)\b/i;

const TIER_FALLBACK_INR = { 1: 220, 2: 480, 3: 960, 4: 2200 };

export function effectiveSpendInr(b) {
  if (!b || b.isFree) return 0;
  const avg = Number(b.avgPrice);
  if (Number.isFinite(avg) && avg > 0) return avg;
  const t = Math.min(4, Math.max(1, Math.round(Number(b.priceTier) || 2)));
  return TIER_FALLBACK_INR[t] || 480;
}

function sustainabilityBenefit(b) {
  const gi = (b.greenInitiatives || []).length;
  const eco = b.ecoOptions || {};
  let s = Math.min(18, gi * 2.5);
  s += eco.plasticFree ? 4 : 0;
  s += eco.solarPowered ? 5 : 0;
  s += eco.zeroWaste ? 4 : 0;
  const tags = (b.tags || []).join(' ').toLowerCase();
  if (/\b(vegan|organic|fair|compost)\b/.test(tags)) s += 3;
  return Math.min(40, s);
}

function communityBenefit(b) {
  let s = 10;
  const name = String(b.name || '');
  if (CHAIN_RE.test(name)) s -= 8;
  const tags = (b.tags || []).map((t) => String(t).toLowerCase());
  if (tags.some((t) => t.includes('independent') || t.includes('local') || t.includes('artisan'))) s += 12;
  s += Math.min(8, Number(b.localKarmaScore || 0) / 15);
  return Math.min(30, Math.max(0, s));
}

function safetyConnectivityBenefit(b) {
  let s = 4;
  if (b.localVerification?.redPin) s += 14;
  const crowd = Number(b.crowdLevel);
  if (Number.isFinite(crowd) && crowd >= 50) s += 4;
  if (Number.isFinite(crowd) && crowd >= 66) s += 2;
  return Math.min(22, s);
}

function incentiveHint(b) {
  let s = 0;
  if (b.carbonWalkIncentive) s += 4;
  if (b.localVerification?.redPin) s += 3;
  s += Math.min(6, (b.greenInitiatives || []).length);
  return Math.min(15, s);
}

function intentWeights(intent) {
  const t = String(intent || '').toLowerCase();
  return {
    sustainability: /\b(eco|green|sustainable|plastic|solar|zero)\b/.test(t) ? 2 : 1,
    community: /\b(local|independent|community|artisan|support)\b/.test(t) ? 1.6 : 1,
    safety: /\b(safe|busy|meetup|buddy|night|lit)\b/.test(t) ? 1.5 : 1,
    budget: /\b(cheap|budget|save|frugal)\b/.test(t) ? 1.4 : 1
  };
}

/** g CO2 equivalent order-of-magnitude for route distance by mode */
function envPenaltyInr(distanceMeters, mode) {
  const km = (Number(distanceMeters) || 0) / 1000;
  const m = String(mode || 'walking').toLowerCase();
  let kgCo2 = 0;
  if (m === 'driving') kgCo2 = km * 0.17;
  else if (m === 'cycling') kgCo2 = km * 0.02;
  else kgCo2 = km * 0.001;
  const socialCostPerKg = 80;
  return Math.round(kgCo2 * socialCostPerKg * 100) / 100;
}

export function scoreMerchantOption(business, travel, intent, transportMode, liveOfferPrice) {
  const financialInr = liveOfferPrice != null && Number.isFinite(Number(liveOfferPrice)) ?
    Number(liveOfferPrice) :
    effectiveSpendInr(business);

  const durationSec = Number(travel?.durationSeconds) || 0;
  const distanceM = Number(travel?.distanceMeters) || 0;
  const opportunityInrPerHour = Number(process.env.COMPARATOR_TIME_VALUE_INR_H || 180);
  const timeCostInr = (durationSec / 3600) * opportunityInrPerHour;

  const env = envPenaltyInr(distanceM, transportMode);

  const w = intentWeights(intent);

  const sus = sustainabilityBenefit(business) * w.sustainability;
  const com = communityBenefit(business) * w.community;
  const saf = safetyConnectivityBenefit(business) * w.safety;
  const inc = incentiveHint(business);

  let benefitScore = Math.min(100, sus + com + saf + inc);

  const budgetPressure = w.budget > 1 ? Math.max(0, financialInr - 200) * 0.02 * (w.budget - 1) : 0;
  benefitScore = Math.max(0, benefitScore - budgetPressure);

  const totalCostScore = Math.max(1, financialInr + timeCostInr + env);

  const valueScore = benefitScore / totalCostScore;

  const walkKm = distanceM / 1000;
  const estimatedCarbonCredits = transportMode === 'walking' ? Math.round(walkKm * 12) / 10 : transportMode === 'cycling' ? Math.round(walkKm * 8) / 10 : 0;
  const estimatedSocialPointsHint = business.localVerification?.redPin ? 2 : 1;

  return {
    businessId: String(business._id),
    name: business.name || 'Place',
    mapDisplayName: business.mapDisplayName || business.name,
    financialInr: Math.round(financialInr),
    timeCostInr: Math.round(timeCostInr * 10) / 10,
    envPenaltyInr: env,
    totalCostScore: Math.round(totalCostScore * 10) / 10,
    benefitScore: Math.round(benefitScore * 10) / 10,
    valueScore: Math.round(valueScore * 1000) / 1000,
    durationSeconds: durationSec,
    distanceMeters: distanceM,
    breakdown: {
      sustainability: Math.round(sus * 10) / 10,
      community: Math.round(com * 10) / 10,
      safetyConnectivity: Math.round(saf * 10) / 10,
      incentives: inc
    },
    usedFlashPrice: liveOfferPrice != null && Number.isFinite(Number(liveOfferPrice)),
    estimatedCarbonCredits,
    estimatedSocialPointsHint
  };
}

export function rankCompareOptions(scored) {
  const sorted = [...scored].sort((a, b) => b.valueScore - a.valueScore);
  const top = sorted[0];
  const second = sorted[1];
  return { sorted, topPickId: top?.businessId, top, second };
}

export function buildTradeoffNudge(top, second, intent) {
  if (!top || !second) return { nudge: '', tradeoff: '' };
  const cheaper = top.financialInr <= second.financialInr ? top : second;
  const pricier = cheaper.businessId === top.businessId ? second : top;
  const betterValue = top.valueScore >= second.valueScore ? top : second;

  const nudge = `Top pick for your goals: ${betterValue.mapDisplayName || betterValue.name} — best benefit per total cost (₹${betterValue.financialInr} visit + time + footprint).`;

  let tradeoff = '';
  if (cheaper.businessId !== betterValue.businessId) {
    tradeoff = `${cheaper.name} is cheaper (₹${cheaper.financialInr} vs ₹${pricier.financialInr}), but ${betterValue.name} scores higher on benefits${/\b(eco|green)\b/i.test(intent) ? ' including sustainability' : ''} and may earn more walk credits if you go on foot.`;
  } else {
    tradeoff = `Both options are close on price; ${betterValue.name} wins on overall value for this trip.`;
  }

  const deltaBenefit = Math.round((top.benefitScore - second.benefitScore) * 10) / 10;
  const deltaPrice = Math.abs(top.financialInr - second.financialInr);
  if (deltaPrice <= 50 && deltaPrice > 0 && deltaBenefit >= 8) {
    tradeoff += ` Paying about ₹${deltaPrice} more unlocks roughly +${deltaBenefit} benefit points (local / green / safe-space signals).`;
  }

  return { nudge, tradeoff };
}
