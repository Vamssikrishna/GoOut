import express from 'express';
import ChatMessage from '../models/ChatMessage.js';
import BuddyGroup from '../models/BuddyGroup.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/:groupId', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const isMember = group.creatorId.toString() === req.user._id.toString() ||
      group.members.some(m => m.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'Not a member' });
    const messages = await ChatMessage.find({ groupId: req.params.groupId })
      .sort({ createdAt: 1 })
      .populate('userId', 'name avatar');
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:groupId/sos', protect, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const group = await BuddyGroup.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const isMember = group.creatorId.toString() === req.user._id.toString() ||
      group.members.some(m => m.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'Not a member' });
    const msg = await ChatMessage.create({
      groupId: req.params.groupId,
      userId: req.user._id,
      userName: req.user.name,
      message: '🚨 EMERGENCY SOS - Location shared',
      isSOS: true,
      sosLocation: lat != null && lng != null ? { type: 'Point', coordinates: [lng, lat] } : undefined
    });
    const io = req.app.get('io');
    if (io) io.to(`group-${req.params.groupId}`).emit('sos', { message: msg, userId: req.user._id });
    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
