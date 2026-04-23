import express from 'express';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function normalizeEmergencyEmails(input) {
  const raw = Array.isArray(input) ?
    input :
    String(input || '')
      .split(/[,\n;]/)
      .map((s) => s.trim());
  return [...new Set(
    raw
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

router.put('/profile', protect, async (req, res) => {
  try {
    const { name, interests, location, weight, emergencyContact, emergencyEmails, buddyMode, avatar } = req.body;
    const update = { lastActive: new Date() };
    if (name !== undefined) update.name = name;
    if (interests !== undefined) update.interests = interests;
    if (buddyMode !== undefined) update.buddyMode = Boolean(buddyMode);
    if (location !== undefined) update.location = location;
    if (weight !== undefined) update.weight = weight;
    if (emergencyContact !== undefined) update.emergencyContact = emergencyContact;
    if (avatar !== undefined) update.avatar = String(avatar || '').trim().slice(0, 280);
    if (emergencyEmails !== undefined) {
      const normalized = normalizeEmergencyEmails(emergencyEmails);
      if (normalized.length < 1 || normalized.length > 3) {
        return res.status(400).json({ error: 'Add at least 1 and at most 3 emergency emails.' });
      }
      if (normalized.some((email) => !EMAIL_RE.test(email))) {
        return res.status(400).json({ error: 'Please enter valid emergency email addresses.' });
      }
      update.emergencyEmails = normalized;
    }
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true }).
    select('-password').
    populate('businessId', 'name category address');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/location', protect, async (req, res) => {
  try {
    const { lng, lat } = req.body;
    if (!lng || !lat) return res.status(400).json({ error: 'Coordinates required' });
    const user = await User.findByIdAndUpdate(req.user._id, {
      location: { type: 'Point', coordinates: [lng, lat] },
      lastActive: new Date()
    }, { new: true }).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/green-stats', protect, async (req, res) => {
  try {
    const { caloriesBurned, co2Saved } = req.body;
    const user = await User.findById(req.user._id);
    user.greenStats.totalCaloriesBurned += caloriesBurned || 0;
    user.greenStats.totalCO2Saved += co2Saved || 0;
    user.greenStats.totalWalks += 1;
    await user.save();
    res.json(user.greenStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/green-stats', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('greenStats');
    res.json(user.greenStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function normalizeDiscoveryPreferencesBody(body) {
  const prefer = Array.isArray(body?.prefer) ?
    [...new Set(body.prefer.map((s) => String(s || '').trim().slice(0, 120)).filter(Boolean))].slice(0, 24) :
    undefined;
  const avoid = Array.isArray(body?.avoid) ?
    [...new Set(body.avoid.map((s) => String(s || '').trim().slice(0, 120)).filter(Boolean))].slice(0, 24) :
    undefined;
  const notes = body?.notes !== undefined ? String(body.notes || '').slice(0, 800) : undefined;
  return { prefer, avoid, notes };
}

router.get('/discovery-preferences', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('discoveryPreferences').lean();
    const d = user?.discoveryPreferences || {};
    res.json({
      prefer: Array.isArray(d.prefer) ? d.prefer : [],
      avoid: Array.isArray(d.avoid) ? d.avoid : [],
      notes: typeof d.notes === 'string' ? d.notes : ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/discovery-preferences', protect, async (req, res) => {
  try {
    const { prefer, avoid, notes } = normalizeDiscoveryPreferencesBody(req.body || {});
    const $set = { lastActive: new Date() };
    if (prefer !== undefined) $set['discoveryPreferences.prefer'] = prefer;
    if (avoid !== undefined) $set['discoveryPreferences.avoid'] = avoid;
    if (notes !== undefined) $set['discoveryPreferences.notes'] = notes;
    if (Object.keys($set).length <= 1) {
      return res.status(400).json({ error: 'Send prefer, avoid, and/or notes' });
    }
    const user = await User.findByIdAndUpdate(req.user._id, { $set }, { new: true }).select('discoveryPreferences');
    res.json(user.discoveryPreferences || { prefer: [], avoid: [], notes: '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;