import express from 'express';
import { optionalProtect } from '../middleware/auth.js';
import User from '../models/User.js';
import { runConciergeChat } from '../services/conciergeEngine.js';

const router = express.Router();

router.post('/chat', optionalProtect, async (req, res) => {
  try {
    const { message, lat, lng, greenMode, mapContext } = req.body || {};
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    let discoveryPreferences = null;
    if (req.user?._id) {
      const u = await User.findById(req.user._id).select('discoveryPreferences').lean();
      discoveryPreferences = u?.discoveryPreferences || null;
    }
    const result = await runConciergeChat({
      message,
      lat,
      lng,
      history,
      greenMode: Boolean(greenMode),
      mapContext: mapContext && typeof mapContext === 'object' ? mapContext : null,
      userId: req.user?._id ? String(req.user._id) : null,
      discoveryPreferences
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
