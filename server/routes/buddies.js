import express from 'express';
import BuddyGroup from '../models/BuddyGroup.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
const PARENT_CATEGORIES = { pottery: 'art', history: 'history', art: 'art', sports: 'sports', music: 'music', food: 'food', reading: 'books', books: 'books' };

function jaccard(a, b) {
  const sa = new Set([...(a || []).map((x) => String(x).toLowerCase())]);
  const sb = new Set([...(b || []).map((x) => String(x).toLowerCase())]);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

router.get('/match', protect, async (req, res) => {
  try {
    const { lng, lat, interests, maxDistance = 5000 } = req.query;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const userTags = interests ? interests.split(',').map((s) => s.trim()).filter(Boolean) : (req.user.interests || []);
    const query = {
      location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: Number(maxDistance) } },
      status: 'open',
      scheduledAt: { $gte: new Date() }
    };
    const groups = await BuddyGroup.find(query).limit(50)
      .populate('creatorId', 'name avatar verified')
      .populate('members', 'name avatar verified');
    const withScore = groups.map((g) => {
      const groupTags = [...(g.interests || []), g.activity].filter(Boolean);
      let sim = jaccard(userTags, groupTags);
      if (sim < 0.4 && userTags.length) {
        const parentTags = userTags.map((t) => PARENT_CATEGORIES[t] || t);
        sim = Math.max(sim, jaccard(parentTags, groupTags));
      }
      return { ...g.toObject(), similarity: sim };
    });
    const matched = withScore.filter((g) => g.similarity >= 0.4).sort((a, b) => b.similarity - a.similarity);
    const result = matched.length ? matched : withScore.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/groups', protect, async (req, res) => {
  try {
    const groups = await BuddyGroup.find({
      $or: [{ creatorId: req.user._id }, { members: req.user._id }, { pendingRequests: req.user._id }]
    }).sort({ scheduledAt: 1 })
      .populate('creatorId', 'name avatar verified')
      .populate('members', 'name avatar verified')
      .populate('pendingRequests', 'name avatar verified');
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups', protect, async (req, res) => {
  try {
    const { activity, description, interests, lat, lng, meetingPlace, scheduledAt, maxMembers, safeBy } = req.body;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const group = await BuddyGroup.create({
      creatorId: req.user._id,
      activity,
      description,
      interests: interests || [],
      location: { type: 'Point', coordinates: coords },
      meetingPlace,
      scheduledAt: new Date(scheduledAt),
      maxMembers: maxMembers || 6,
      members: [req.user._id],
      safeBy: safeBy ? new Date(safeBy) : undefined,
      safeByUserId: safeBy ? req.user._id : undefined
    });
    const populated = await BuddyGroup.findById(group._id)
      .populate('creatorId', 'name avatar verified')
      .populate('members', 'name avatar verified');
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/join', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.status !== 'open') return res.status(400).json({ error: 'Group is not open' });
    if (group.members.length >= group.maxMembers) return res.status(400).json({ error: 'Group is full' });
    if (group.members.some(m => m.toString() === req.user._id.toString()))
      return res.status(400).json({ error: 'Already a member' });
    if (group.pendingRequests?.some((m) => m.toString() === req.user._id.toString()))
      return res.status(400).json({ error: 'Request already pending' });
    group.pendingRequests = group.pendingRequests || [];
    group.pendingRequests.push(req.user._id);
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
    const populated = await BuddyGroup.findById(group._id)
      .populate('creatorId', 'name avatar verified')
      .populate('members', 'name avatar verified')
      .populate('pendingRequests', 'name avatar verified');
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
    const populated = await BuddyGroup.findById(group._id)
      .populate('creatorId', 'name avatar verified')
      .populate('members', 'name avatar verified')
      .populate('pendingRequests', 'name avatar verified');
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
    const populated = await BuddyGroup.findById(group._id)
      .populate('creatorId', 'name avatar verified')
      .populate('members', 'name avatar verified')
      .populate('pendingRequests', 'name avatar verified');
    res.json({ deleted: false, group: populated });
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
    const group = await BuddyGroup.findById(req.params.id)
      .populate('creatorId', 'name avatar verified')
      .populate('members', 'name avatar verified')
      .populate('pendingRequests', 'name avatar verified');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
