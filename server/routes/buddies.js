import express from 'express';
import BuddyGroup from '../models/BuddyGroup.js';
import User from '../models/User.js';
import Business from '../models/Business.js';
import { protect } from '../middleware/auth.js';
import { fetchPublicSpacesNear } from '../services/publicPlaces.js';
import { generateGroupDescription, generateMultipleDescriptions } from '../services/buddyGroupAi.js';
import {
  createGeminiClient,
  getGenerativeModelForModelId,
  DEFAULT_GEMINI_MODEL,
  buildGeminiCandidateModels,
  GEMINI_KEY_SCOPES,
  isLikelyGeminiError,
  formatGeminiUserMessage
} from '../config/geminiConfig.js';

const router = express.Router();
const PARENT_CATEGORIES = { pottery: 'art', history: 'history', art: 'art', sports: 'sports', music: 'music', food: 'food', reading: 'books', books: 'books' };

function jaccard(a, b) {
  const sa = new Set([...(a || []).map((x) => String(x).toLowerCase())]);
  const sb = new Set([...(b || []).map((x) => String(x).toLowerCase())]);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

function distanceMeters(la1, lo1, la2, lo2) {
  const R = 6371e3;
  const phi1 = la1 * Math.PI / 180;
  const phi2 = la2 * Math.PI / 180;
  const dPhi = (la2 - la1) * Math.PI / 180;
  const dLambda = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'Explorer';
}

function greenScoreFromUser(u) {
  const w = Number(u.greenStats?.totalWalks || 0);
  const co2 = Number(u.greenStats?.totalCO2Saved || 0);
  const sp = Number(u.socialPoints || 0);
  return Math.min(100, Math.round(w * 3 + co2 * 0.08 + sp * 2));
}

function looksLikePrivateAddress(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  return /\b(apt|apartment|appt|unit|suite|studio|#|flat|floor|hostel|room\s*\d|airbnb)\b/i.test(t);
}

function chatExpiryFromScheduled(scheduledAt) {
  const t = new Date(scheduledAt).getTime();
  if (!Number.isFinite(t)) return new Date(Date.now() + 2 * 3600000);
  return new Date(t + 2 * 3600000);
}

function sanitizeSafeVenue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'red_pin' ? 'red_pin' : 'public_plaza';
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    kind,
    name: String(raw.name || '').trim().slice(0, 160),
    lat,
    lng,
    businessId: raw.businessId || undefined,
    placeId: String(raw.placeId || '').trim().slice(0, 120),
    safetyNote: String(raw.safetyNote || '').trim().slice(0, 400)
  };
}

function buddyPublicPreview(u) {
  if (!u) return null;
  return {
    id: u._id,
    displayName: firstName(u.name),
    interests: u.interests || [],
    greenScore: greenScoreFromUser(u),
    avatar: u.avatar || '',
    buddyMode: Boolean(u.buddyMode)
  };
}

function safeJson(raw) {
  try {
    return JSON.parse(String(raw || '').trim());
  } catch {
    return null;
  }
}

async function expandBuddyIntentKeywords(intentText) {
  const base = String(intentText || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && w.length < 24)
    .slice(0, 12);
  if (!base.length) return base;
  const genAI = createGeminiClient(GEMINI_KEY_SCOPES.BUDDIES_MATCHING);
  if (!genAI) return base;

  const prompt = `Expand this buddy meetup intent into concise keyword tags.
Intent: "${String(intentText || '').slice(0, 180)}"
Return strict JSON only:
{"keywords":["string"]}
Rules:
- output 4 to 10 short words/phrases
- focus on activities and vibe
- no sentences`;
  const candidates = buildGeminiCandidateModels(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
  for (const modelId of candidates) {
    try {
      const model = getGenerativeModelForModelId(genAI, modelId, {
        generationConfig: { temperature: 0.2, maxOutputTokens: 180, responseMimeType: 'application/json' }
      });
      if (!model) continue;
      const result = await model.generateContent(prompt);
      const parsed = safeJson(result?.response?.text?.() || '');
      const aiWords = Array.isArray(parsed?.keywords) ?
        parsed.keywords.map((x) => String(x || '').toLowerCase().trim()).filter(Boolean).slice(0, 12) :
        [];
      const merged = Array.from(new Set([...base, ...aiWords]));
      if (merged.length) return merged;
    } catch {
      // try next model
    }
  }
  return base;
}

function normalizeTokens(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .flatMap((v) => String(v || '').toLowerCase().split(/[^a-z0-9]+/))
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && t.length <= 28)
  )];
}

function buildUserPreferenceTokens(userDoc) {
  const interests = normalizeTokens(userDoc?.interests || []);
  const prefer = normalizeTokens(userDoc?.discoveryPreferences?.prefer || []);
  const avoid = normalizeTokens(userDoc?.discoveryPreferences?.avoid || []);
  return { interests, prefer, avoid };
}

function tokenMatchRatio(intentTokens, userTokens) {
  if (!intentTokens.length || !userTokens.length) return 0;
  const hits = intentTokens.filter((t) => userTokens.some((u) => u.includes(t) || t.includes(u))).length;
  return hits / intentTokens.length;
}

function lastActiveRecencyBoost(lastActive) {
  const t = new Date(lastActive).getTime();
  if (!Number.isFinite(t)) return 0;
  const hours = Math.max(0, (Date.now() - t) / 3600000);
  if (hours <= 6) return 0.08;
  if (hours <= 24) return 0.05;
  if (hours <= 72) return 0.02;
  return 0;
}

function scoreInviteCandidate({ intentTokens, creatorTokens, candidateTokens, proximityScore, userDoc }) {
  const intentInterest = tokenMatchRatio(intentTokens, candidateTokens.interests);
  const intentPrefer = tokenMatchRatio(intentTokens, candidateTokens.prefer);
  const creatorToCandidate = jaccard(
    [...creatorTokens.interests, ...creatorTokens.prefer],
    [...candidateTokens.interests, ...candidateTokens.prefer]
  );
  const avoidPenalty = tokenMatchRatio(intentTokens, candidateTokens.avoid) * 0.55;
  const base =
    (intentInterest * 0.46) +
    (intentPrefer * 0.2) +
    (creatorToCandidate * 0.22) +
    (Math.max(0, Math.min(1, proximityScore)) * 0.12);
  return Math.max(0, Math.min(1, base - avoidPenalty + lastActiveRecencyBoost(userDoc?.lastActive)));
}

function weightedRandomPick(scored, limit) {
  const pool = [...scored];
  const out = [];
  while (pool.length && out.length < limit) {
    const total = pool.reduce((s, x) => s + Math.max(0.0001, x.score), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx += 1) {
      r -= Math.max(0.0001, pool[idx].score);
      if (r <= 0) break;
    }
    const chosen = pool.splice(Math.min(idx, pool.length - 1), 1)[0];
    if (chosen) out.push(chosen);
  }
  return out;
}

router.get('/match', protect, async (req, res) => {
  try {
    const { lng, lat, interests, intent, maxDistance = 5000 } = req.query;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const rawIntent = String(intent || interests || '').trim();
    const aiExpanded = rawIntent ? await expandBuddyIntentKeywords(rawIntent) : [];
    const userTags = rawIntent ?
      aiExpanded :
      (req.user.interests || []).map((x) => String(x).trim()).filter(Boolean);
    const query = {
      location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: Number(maxDistance) } },
      status: 'open',
      scheduledAt: { $gte: new Date() }
    };
    const groups = await BuddyGroup.find(query).limit(50).
    populate('creatorId', 'name avatar verified buddyMode').
    populate('members', 'name avatar verified');
    const discoverable = groups.filter((g) => g.creatorId?.buddyMode !== false);
    const withScore = discoverable.map((g) => {
      const groupTags = [...(g.interests || []), g.activity, g.description].filter(Boolean);
      let sim = jaccard(userTags, groupTags);
      if (sim < 0.4 && userTags.length) {
        const parentTags = userTags.map((t) => PARENT_CATEGORIES[t] || t);
        sim = Math.max(sim, jaccard(parentTags, groupTags));
      }
      return { ...g.toObject(), similarity: sim, matchPercent: Math.round(sim * 100) };
    });
    const matched = withScore.filter((g) => g.similarity >= 0.4).sort((a, b) => b.similarity - a.similarity);
    const result = matched.length ? matched : withScore.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Buddies with Buddy Mode on, matched by intent + profile preferences (no proximity filter). */
router.get('/groups/suggested-peers', protect, async (req, res) => {
  try {
    if (!req.user.buddyMode) return res.json([]);
    const { intent } = req.query;
    const me = await User.findById(req.user._id).select('interests discoveryPreferences');
    const meTokens = buildUserPreferenceTokens(me);
    const intentWords = await expandBuddyIntentKeywords(intent || '');
    const myDiscoveryTokens = [...meTokens.interests, ...meTokens.prefer];

    const others = await User.find({
      _id: { $ne: req.user._id },
      buddyMode: true
    }).
    limit(80).
    select('name interests discoveryPreferences avatar greenStats socialPoints buddyMode lastActive');

    const scored = others.map((u) => {
      const candidateTokens = buildUserPreferenceTokens(u);
      const candidateDiscovery = [...candidateTokens.interests, ...candidateTokens.prefer];
      const interestAlign = tokenMatchRatio(intentWords, candidateTokens.interests);
      const preferAlign = tokenMatchRatio(intentWords, candidateTokens.prefer);
      const preferenceOverlap = jaccard(myDiscoveryTokens, candidateDiscovery);
      const avoidHitByIntent = tokenMatchRatio(intentWords, candidateTokens.avoid);
      const avoidConflict = jaccard(meTokens.avoid, candidateDiscovery);
      const mutualAvoidConflict = jaccard(candidateTokens.avoid, myDiscoveryTokens);
      const avoidPenalty = Math.min(
        0.8,
        (avoidHitByIntent * 0.45) +
          (avoidConflict * 0.35) +
          (mutualAvoidConflict * 0.2)
      );
      const recency = lastActiveRecencyBoost(u?.lastActive);
      const rawScore =
        (interestAlign * 0.38) +
        (preferAlign * 0.24) +
        (preferenceOverlap * 0.32) +
        recency -
        avoidPenalty;
      const totalScore = Math.max(0, Math.min(1, rawScore));
      return {
        user: u,
        totalScore,
        intentPercent: Math.round(Math.max(interestAlign, preferAlign) * 100),
        preferencePercent: Math.round(preferenceOverlap * 100),
        avoidPenaltyPercent: Math.round(avoidPenalty * 100)
      };
    });
    scored.sort((a, b) => b.totalScore - a.totalScore);
    const out = scored.slice(0, 50).map(({ user: u, totalScore, intentPercent, preferencePercent, avoidPenaltyPercent }) => ({
      ...buddyPublicPreview(u),
      similarity: Math.round(totalScore * 100) / 100,
      matchPercent: Math.round(totalScore * 100),
      intentPercent,
      preferencePercent,
      avoidPenaltyPercent
    }));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Red Pin merchants + public plazas/parks (no private addresses). */
router.get('/groups/safe-venues', protect, async (req, res) => {
  try {
    const { lng, lat, maxDistance = 6000 } = req.query;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const redPins = await Business.find({
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: coords },
          $maxDistance: Number(maxDistance) || 6000
        }
      },
      'localVerification.redPin': true
    }).
    limit(12).
    select('name category address location localVerification mapDisplayName');

    const redOut = redPins.map((b) => {
      const c = b.location?.coordinates || [];
      return {
        kind: 'red_pin',
        name: String(b.mapDisplayName || b.name || 'Local partner').trim(),
        businessId: b._id,
        lat: c[1],
        lng: c[0],
        category: b.category,
        safetyNote: 'Red Pin verified local merchant — high footfall, safer for first meetups.'
      };
    });

    const publicRaw = await fetchPublicSpacesNear(coords[1], coords[0], Number(maxDistance) || 6000, 'public square plaza pedestrian park library');
    const plazaish = (publicRaw || []).filter((p) => {
      const cat = String(p.category || p.primaryType || '').toLowerCase();
      const n = String(p.name || '').toLowerCase();
      return /\b(plaza|square|park|garden|library|mall|promenade|walk)\b/.test(cat) ||
        /\b(plaza|square|park|garden|library)\b/.test(n);
    }).slice(0, 8);

    const pubOut = plazaish.map((p) => ({
      kind: 'public_plaza',
      name: p.name,
      placeId: p.id || p.placeId || '',
      lat: p.lat,
      lng: p.lng,
      category: p.category,
      safetyNote: 'Public, open location — meet in daylight near other visitors.'
    }));

    res.json({ redPin: redOut, publicPlazas: pubOut });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/groups/pending-invites', protect, async (req, res) => {
  try {
    const groups = await BuddyGroup.find({
      $or: [
        { inviteTargetUserId: req.user._id },
        { invitedUsers: req.user._id }
      ],
      members: { $nin: [req.user._id] },
      creatorId: { $ne: req.user._id }
    }).
    sort({ scheduledAt: 1 }).
    populate('creatorId', 'name interests avatar greenStats socialPoints buddyMode');

    const out = groups.map((g) => ({
      ...g.toObject(),
      inviteType: String(g?.inviteTargetUserId || '') === String(req.user._id) ? 'pair' : 'group',
      creatorBuddyPreview: buddyPublicPreview(g.creatorId)
    }));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/groups', protect, async (req, res) => {
  try {
    const groups = await BuddyGroup.find({
      $or: [
        { creatorId: req.user._id },
        { members: req.user._id },
        { pendingRequests: req.user._id },
        { invitedUsers: req.user._id }
      ]
    }).sort({ scheduledAt: 1 }).
    populate('creatorId', 'name avatar verified').
    populate('members', 'name avatar verified').
    populate('pendingRequests', 'name avatar verified');
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups', protect, async (req, res) => {
  try {
    const {
      activity,
      description,
      interests,
      lat,
      lng,
      meetingPlace,
      scheduledAt,
      maxMembers,
      safeBy,
      inviteTargetUserId,
      safeVenue: safeVenueBody,
      intentSnippet
    } = req.body;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    if (!req.user?.buddyMode) {
      return res.status(403).json({ error: 'Buddy Mode must be ON to create groups or pair hangouts.' });
    }
    const scheduled = new Date(scheduledAt);
    const safeVenue = sanitizeSafeVenue(safeVenueBody);
    if (looksLikePrivateAddress(meetingPlace) && !safeVenue) {
      return res.status(400).json({
        error: 'Private or home-style addresses cannot be used as meetup spots. Choose a Red Pin partner or a public plaza from Safe Venues.'
      });
    }
    if (inviteTargetUserId && !safeVenue) {
      return res.status(400).json({
        error: 'Directed hangout invites require a safe venue (Red Pin merchant or public plaza) with map coordinates.'
      });
    }
    if (inviteTargetUserId) {
      const target = await User.findById(inviteTargetUserId).select('buddyMode');
      if (!target) return res.status(404).json({ error: 'Invite user not found' });
      if (!target.buddyMode) {
        return res.status(400).json({ error: 'That explorer has Buddy Mode off and cannot receive hangout invites.' });
      }
    }
    const parsedMaxMembers = Number.parseInt(maxMembers, 10);
    const maxM = inviteTargetUserId ?
      2 :
      (Number.isFinite(parsedMaxMembers) ? Math.max(3, Math.min(20, parsedMaxMembers)) : 3);
    
    const finalDescription = String(description || '').trim();
    const baseIntent = String(intentSnippet || activity || '').trim();
    const quickIntentTokens = normalizeTokens([
      ...(Array.isArray(interests) ? interests : []),
      baseIntent
    ]);
    const group = await BuddyGroup.create({
      creatorId: req.user._id,
      activity,
      description: finalDescription,
      interests: quickIntentTokens.slice(0, 10),
      intentSnippet: String(intentSnippet || '').trim().slice(0, 500),
      location: { type: 'Point', coordinates: coords },
      meetingPlace,
      safeVenue: safeVenue || undefined,
      scheduledAt: scheduled,
      maxMembers: maxM,
      members: [req.user._id],
      inviteTargetUserId: inviteTargetUserId || undefined,
      chatExpiresAt: chatExpiryFromScheduled(scheduled),
      safeBy: safeBy ? new Date(safeBy) : undefined,
      safeByUserId: safeBy ? req.user._id : undefined,
      invitedUsers: [],
      declinedInvites: []
    });

    const populated = await BuddyGroup.findById(group._id).
    populate('creatorId', 'name avatar verified').
    populate('members', 'name avatar verified');
    res.status(201).json(populated);

    // Post-processing in background so group creation returns fast.
    setImmediate(async () => {
      try {
        const nextIntentTokens = await expandBuddyIntentKeywords(baseIntent);
        if (nextIntentTokens.length) {
          await BuddyGroup.findByIdAndUpdate(group._id, {
            $set: { interests: nextIntentTokens.slice(0, 10) }
          });
        }

        if (!finalDescription && activity) {
          const aiDescription = await generateGroupDescription(activity, interests || [], meetingPlace || '');
          const trimmed = String(aiDescription || '').trim();
          if (trimmed) {
            await BuddyGroup.findOneAndUpdate(
              { _id: group._id, $or: [{ description: { $exists: false } }, { description: '' }] },
              { $set: { description: trimmed } }
            );
          }
        }

        // Group mode: auto-invite AI-matched users up to max members.
        if (!inviteTargetUserId && maxM > 1) {
          const creator = await User.findById(req.user._id).select('interests discoveryPreferences location');
          const creatorTokens = buildUserPreferenceTokens(creator);
          const maxDistanceMeters = 12000;
          const candidates = await User.find({
            _id: { $ne: req.user._id },
            buddyMode: true,
            location: {
              $nearSphere: {
                $geometry: { type: 'Point', coordinates: coords },
                $maxDistance: maxDistanceMeters
              }
            }
          })
            .select('interests discoveryPreferences lastActive location')
            .limit(60);

          const scored = candidates.map((u) => {
            const c = u?.location?.coordinates || [];
            const uLng = Number(c?.[0]);
            const uLat = Number(c?.[1]);
            const dist = (Number.isFinite(uLat) && Number.isFinite(uLng)) ? distanceMeters(coords[1], coords[0], uLat, uLng) : maxDistanceMeters;
            const proximityScore = Math.max(0, Math.min(1, 1 - (dist / maxDistanceMeters)));
            const candidateTokens = buildUserPreferenceTokens(u);
            const score = scoreInviteCandidate({
              intentTokens: nextIntentTokens.length ? nextIntentTokens : quickIntentTokens,
              creatorTokens,
              candidateTokens,
              proximityScore,
              userDoc: u
            });
            return { userId: u._id, score };
          })
            .filter((x) => x.score >= 0.38)
            .sort((a, b) => b.score - a.score);

          const shortlist = scored.slice(0, 20);
          const chosen = weightedRandomPick(shortlist, Math.max(0, maxM - 1));
          if (chosen.length) {
            await BuddyGroup.findByIdAndUpdate(group._id, {
              $set: { invitedUsers: chosen.map((c) => c.userId) }
            });
          }
        }
      } catch (bgErr) {
        console.warn('[buddies] post-create processing failed:', bgErr?.message || bgErr);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/join', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.inviteTargetUserId) {
      if (group.inviteTargetUserId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'This hangout is invite-only for another guest.' });
      }
      return res.status(400).json({ error: 'Open your invite and use Accept hangout instead of Request to Join.' });
    }
    if (group.status !== 'open') return res.status(400).json({ error: 'Group is not open' });
    if (group.members.length >= group.maxMembers) return res.status(400).json({ error: 'Group is full' });
    if (group.members.some((m) => m.toString() === req.user._id.toString()))
    return res.status(400).json({ error: 'Already a member' });
    if (group.pendingRequests?.some((m) => m.toString() === req.user._id.toString()))
    return res.status(400).json({ error: 'Request already pending' });
    if (group.invitedUsers?.some((m) => m.toString() === req.user._id.toString())) {
      group.invitedUsers = (group.invitedUsers || []).filter((m) => m.toString() !== req.user._id.toString());
      if (!group.members.some((u) => u.toString() === req.user._id.toString())) {
        group.members.push(req.user._id);
      }
      if (group.members.length >= group.maxMembers) group.status = 'full';
      await group.save();
      const populated = await BuddyGroup.findById(group._id).
        populate('creatorId', 'name avatar verified').
        populate('members', 'name avatar verified').
        populate('pendingRequests', 'name avatar verified');
      return res.json(populated);
    }
    group.pendingRequests = group.pendingRequests || [];
    group.pendingRequests.push(req.user._id);
    await group.save();
    const populated = await BuddyGroup.findById(group._id).
    populate('creatorId', 'name avatar verified').
    populate('members', 'name avatar verified').
    populate('pendingRequests', 'name avatar verified');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/accept-invite', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const uid = req.user._id.toString();
    const invited = (group.invitedUsers || []).some((u) => u.toString() === uid);
    if (!invited) return res.status(403).json({ error: 'You are not invited to this group.' });
    if (group.members.some((u) => u.toString() === uid)) {
      return res.status(400).json({ error: 'Already a member.' });
    }
    if (group.members.length >= group.maxMembers) {
      return res.status(400).json({ error: 'Group is full.' });
    }
    group.invitedUsers = (group.invitedUsers || []).filter((u) => u.toString() !== uid);
    group.declinedInvites = (group.declinedInvites || []).filter((u) => u.toString() !== uid);
    group.members.push(req.user._id);
    if (group.members.length >= group.maxMembers) group.status = 'full';
    await group.save();
    const populated = await BuddyGroup.findById(group._id)
      .populate('creatorId', 'name avatar verified')
      .populate('members', 'name avatar verified')
      .populate('pendingRequests', 'name avatar verified');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/reject-invite', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const uid = req.user._id.toString();
    const invited = (group.invitedUsers || []).some((u) => u.toString() === uid);
    if (!invited) return res.status(403).json({ error: 'You are not invited to this group.' });
    group.invitedUsers = (group.invitedUsers || []).filter((u) => u.toString() !== uid);
    if (!group.declinedInvites?.some((u) => u.toString() === uid)) {
      group.declinedInvites = [...(group.declinedInvites || []), req.user._id];
    }
    await group.save();
    res.json({ removed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/accept/:userId', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.creatorId.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Only creator can accept requests' });
    const targetId = req.params.userId;
    if (!group.pendingRequests?.some((u) => u.toString() === targetId)) return res.status(404).json({ error: 'Request not found' });
    if (group.members.length >= group.maxMembers) return res.status(400).json({ error: 'Group is full' });
    group.pendingRequests = (group.pendingRequests || []).filter((u) => u.toString() !== targetId);
    if (!group.members.some((u) => u.toString() === targetId)) group.members.push(targetId);
    if (group.members.length >= group.maxMembers) group.status = 'full';
    await group.save();
    const populated = await BuddyGroup.findById(group._id).
    populate('creatorId', 'name avatar verified').
    populate('members', 'name avatar verified').
    populate('pendingRequests', 'name avatar verified');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/reject/:userId', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.creatorId.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Only creator can reject requests' });
    const targetId = req.params.userId;
    group.pendingRequests = (group.pendingRequests || []).filter((u) => u.toString() !== targetId);
    await group.save();
    const populated = await BuddyGroup.findById(group._id).
    populate('creatorId', 'name avatar verified').
    populate('members', 'name avatar verified').
    populate('pendingRequests', 'name avatar verified');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/leave', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const uid = req.user._id.toString();
    if (group.creatorId.toString() === uid) {
      await BuddyGroup.findByIdAndDelete(group._id);
      return res.json({ deleted: true });
    }
    group.members = (group.members || []).filter((m) => m.toString() !== uid);
    group.pendingRequests = (group.pendingRequests || []).filter((m) => m.toString() !== uid);
    if (group.status === 'full' && group.members.length < group.maxMembers) group.status = 'open';
    await group.save();
    const populated = await BuddyGroup.findById(group._id).
    populate('creatorId', 'name avatar verified').
    populate('members', 'name avatar verified').
    populate('pendingRequests', 'name avatar verified');
    res.json({ deleted: false, group: populated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/accept-hangout', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.inviteTargetUserId || group.inviteTargetUserId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You are not the invited guest for this hangout.' });
    }
    if (group.members.some((m) => m.toString() === req.user._id.toString())) {
      return res.status(400).json({ error: 'You have already joined this hangout.' });
    }
    if (group.members.length >= group.maxMembers) return res.status(400).json({ error: 'This hangout is full' });
    group.members.push(req.user._id);
    if (group.members.length >= group.maxMembers) group.status = 'full';
    group.chatExpiresAt = group.chatExpiresAt || chatExpiryFromScheduled(group.scheduledAt);
    await group.save();
    const populated = await BuddyGroup.findById(group._id).
    populate('creatorId', 'name avatar verified interests greenStats socialPoints').
    populate('members', 'name avatar verified interests greenStats socialPoints').
    populate('pendingRequests', 'name avatar verified');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/reject-hangout', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.inviteTargetUserId || group.inviteTargetUserId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You are not the invited guest for this hangout.' });
    }
    await BuddyGroup.findByIdAndDelete(group._id);
    res.json({ removed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/post-meetup', protect, async (req, res) => {
  try {
    const { didMeet, locationSafe, walkedThere } = req.body;
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const uid = req.user._id.toString();
    const isMember = group.creatorId.toString() === uid ||
    group.members.some((m) => m.toString() === uid);
    if (!isMember) return res.status(403).json({ error: 'Not a member' });
    const prev = (group.postMeetupFeedback || []).find((f) => f.userId.toString() === uid);
    group.postMeetupFeedback = (group.postMeetupFeedback || []).filter((f) => f.userId.toString() !== uid);
    group.postMeetupFeedback.push({
      userId: req.user._id,
      didMeet: Boolean(didMeet),
      locationSafe: Boolean(locationSafe),
      walkedThere: Boolean(walkedThere),
      at: new Date()
    });
    const nowPositive = Boolean(didMeet) && Boolean(locationSafe);
    const wasPositive = Boolean(prev?.didMeet) && Boolean(prev?.locationSafe);
    if (nowPositive && !wasPositive) {
      await User.findByIdAndUpdate(req.user._id, { $inc: { socialPoints: 4 } });
    }
    const byUser = new Map((group.postMeetupFeedback || []).map((f) => [f.userId.toString(), f]));
    const uniqueFb = [...byUser.values()];
    const bothPositive = uniqueFb.length >= 2 && uniqueFb.every((f) => f.didMeet && f.locationSafe);
    const bothWalked = uniqueFb.length >= 2 && uniqueFb.every((f) => f.walkedThere && f.didMeet);
    if (!group.carbonMeetupBonusAwarded && group.safeVenue?.kind === 'red_pin' && bothWalked && bothPositive) {
      group.carbonMeetupBonusAwarded = true;
      const bonusCo2 = 0.35;
      for (const m of group.members) {
        await User.findByIdAndUpdate(m, {
          $inc: {
            'greenStats.totalCO2Saved': bonusCo2,
            'greenStats.totalWalks': 1,
            socialPoints: 6
          }
        });
      }
    }
    await group.save();
    res.json({ ok: true, postMeetupFeedback: group.postMeetupFeedback, carbonBonusAwarded: group.carbonMeetupBonusAwarded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/safe', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const isMember = group.creatorId.toString() === req.user._id.toString() || group.members.some((m) => m.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'Not a member' });
    await BuddyGroup.findByIdAndUpdate(req.params.id, { $unset: { safeBy: 1, safeByUserId: 1 } });
    res.json({ message: 'Marked safe' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/groups/:id', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id).
    populate('creatorId', 'name avatar verified').
    populate('members', 'name avatar verified').
    populate('pendingRequests', 'name avatar verified');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Generate a unique description for a buddy group based on activity. */
router.post('/generate-description', protect, async (req, res) => {
  try {
    const { activity, interests = [], meetingPlace = '' } = req.body;
    const activity_trimmed = String(activity || '').trim();
    
    if (!activity_trimmed) {
      return res.status(400).json({ error: 'Activity is required to generate a description' });
    }
    
    const description = await generateGroupDescription(activity_trimmed, interests, meetingPlace);
    
    if (!description) {
      return res.status(503).json({ error: formatGeminiUserMessage(null) });
    }
    
    res.json({ description });
  } catch (err) {
    if (isLikelyGeminiError(err)) {
      return res.status(503).json({ error: formatGeminiUserMessage(err) });
    }
    res.status(500).json({ error: err.message });
  }
});

/** Generate multiple description options for a buddy group (preview). */
router.post('/generate-descriptions-preview', protect, async (req, res) => {
  try {
    const { activity, interests = [], meetingPlace = '' } = req.body;
    const activity_trimmed = String(activity || '').trim();
    
    if (!activity_trimmed) {
      return res.status(400).json({ error: 'Activity is required to generate descriptions' });
    }
    
    const descriptions = await generateMultipleDescriptions(activity_trimmed, interests, meetingPlace, 3);
    
    if (!descriptions || descriptions.length === 0) {
      return res.status(503).json({ error: formatGeminiUserMessage(null) });
    }
    
    res.json({ descriptions });
  } catch (err) {
    if (isLikelyGeminiError(err)) {
      return res.status(503).json({ error: formatGeminiUserMessage(err) });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;