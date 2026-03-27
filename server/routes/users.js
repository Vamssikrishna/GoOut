import express from 'express';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.put('/profile', protect, async (req, res) => {
  try {
    const { name, interests, location, weight, emergencyContact } = req.body;
    const update = { lastActive: new Date() };
    if (name !== undefined) update.name = name;
    if (interests !== undefined) update.interests = interests;
    if (location !== undefined) update.location = location;
    if (weight !== undefined) update.weight = weight;
    if (emergencyContact !== undefined) update.emergencyContact = emergencyContact;
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true })
      .select('-password');
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

export default router;
