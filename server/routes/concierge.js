import express from 'express';
import { optionalProtect } from '../middleware/auth.js';
import User from '../models/User.js';
import Visit from '../models/Visit.js';
import { runConciergeChat } from '../services/conciergeEngine.js';

const router = express.Router();

router.post('/chat', optionalProtect, async (req, res) => {
  try {
    const { message, lat, lng, greenMode, mapContext, explorationRadiusM } = req.body || {};
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    let discoveryPreferences = null;
    let userDisplayName = null;
    let userActivitySnapshot = null;
    if (req.user?._id) {
      const [u, visits] = await Promise.all([
        User.findById(req.user._id).
          select('discoveryPreferences name greenStats carbonCredits weight socialPoints verified').
          lean(),
        Visit.find({ userId: req.user._id }).select('distanceWalked').lean()
      ]);
      discoveryPreferences = u?.discoveryPreferences || null;
      const rawName = typeof u?.name === 'string' ? u.name.trim() : '';
      userDisplayName = rawName ? rawName.slice(0, 120) : null;
      const totalWalkM = (visits || []).reduce((s, v) => s + (Number(v?.distanceWalked) || 0), 0);
      const wKg = Number(u?.weight);
      userActivitySnapshot = {
        greenStats: u?.greenStats || {},
        carbonCredits: Number(u?.carbonCredits) || 0,
        socialPoints: Number(u?.socialPoints) || 0,
        weightKg: Number.isFinite(wKg) ? wKg : null,
        verified: Boolean(u?.verified),
        visitCount: visits?.length || 0,
        totalWalkDistanceMeters: totalWalkM,
        approximateCaloriesFromVisits: Math.round(totalWalkM / 1000 * 0.75 * (Number.isFinite(wKg) ? wKg : 65))
      };
    }
    const result = await runConciergeChat({
      message,
      lat,
      lng,
      history,
      greenMode: Boolean(greenMode),
      mapContext: mapContext && typeof mapContext === 'object' ? mapContext : null,
      userId: req.user?._id ? String(req.user._id) : null,
      discoveryPreferences,
      userDisplayName,
      explorationRadiusM: Number(explorationRadiusM),
      userActivitySnapshot
    });

    if (result.error) {
      const uid = req.user?._id?.toString?.() || 'anonymous';
      console.log('[CityConcierge]', {
        user: uid,
        error: result.error,
        messagePreview: String(message || '').slice(0, 400)
      });
      return res.status(result.status || 500).json({ error: result.error });
    }

    const uid = req.user?._id?.toString?.() || 'anonymous';
    console.log('[CityConcierge]', {
      user: uid,
      lat,
      lng,
      userMessage: String(message || ''),
      aiReply: String(result.reply || ''),
      browseIntent: result.meta?.browseIntent,
      offline: Boolean(result.meta?.offline),
      outOfScope: Boolean(result.meta?.outOfScope)
    });

    return res.json(result);
  } catch (e) {
    console.error('[concierge] route', e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
});

export default router;
