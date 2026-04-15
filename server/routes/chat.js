import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import ChatMessage from '../models/ChatMessage.js';
import BuddyGroup from '../models/BuddyGroup.js';
import { protect } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chatUploadDir = join(__dirname, '../uploads/chat');
fs.mkdirSync(chatUploadDir, { recursive: true });

const allowedChatMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
]);

const chatStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, chatUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.bin';
    const safeExt = ext.length <= 8 ? ext : '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  }
});

const chatUpload = multer({
  storage: chatStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (allowedChatMime.has(file.mimetype)) return cb(null, true);
    cb(new Error('File type not allowed for chat'));
  }
});

function getMimeTypeCategory(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

const router = express.Router();

router.get('/:groupId', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const isMember = group.creatorId.toString() === req.user._id.toString() ||
    group.members.some((m) => m.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'Not a member' });
    const messages = await ChatMessage.find({ groupId: req.params.groupId }).
    sort({ createdAt: 1 }).
    populate('userId', 'name avatar');
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
    group.members.some((m) => m.toString() === req.user._id.toString());
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

/** Upload file/image/video to chat */
router.post('/:groupId/upload', protect, (req, res) => {
  chatUpload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.message || 'Upload failed';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const group = await BuddyGroup.findById(req.params.groupId);
      if (!group) return res.status(404).json({ error: 'Group not found' });
      
      const isMember = group.creatorId.toString() === req.user._id.toString() ||
        group.members.some((m) => m.toString() === req.user._id.toString());
      if (!isMember) return res.status(403).json({ error: 'Not a member' });

      const attachment = {
        url: `/uploads/chat/${req.file.filename}`,
        filename: req.file.originalname || req.file.filename,
        mimetype: req.file.mimetype,
        type: getMimeTypeCategory(req.file.mimetype)
      };

      const msg = await ChatMessage.create({
        groupId: req.params.groupId,
        userId: req.user._id,
        userName: req.user.name,
        message: `📎 Shared ${attachment.type}: ${attachment.filename}`,
        attachments: [attachment]
      });

      const populated = await msg.populate('userId', 'name avatar');
      const io = req.app.get('io');
      if (io) io.to(`group-${req.params.groupId}`).emit('new-message', populated);
      
      res.status(201).json({ message: msg, attachment });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

/** Leave group / pair hangout */
router.post('/:groupId/leave', protect, async (req, res) => {
  try {
    const group = await BuddyGroup.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const userId = req.user._id;
    const isMember = group.creatorId.toString() === userId.toString() ||
      group.members.some((m) => m.toString() === userId.toString());
    
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    // Remove user from group
    group.members = group.members.filter((m) => m.toString() !== userId.toString());
    group.pendingRequests = group.pendingRequests.filter((p) => p.toString() !== userId.toString());

    // If user is creator and no members left, delete the group
    if (group.creatorId.toString() === userId.toString() && group.members.length === 0) {
      await BuddyGroup.findByIdAndDelete(req.params.groupId);
      // Also delete all messages
      await ChatMessage.deleteMany({ groupId: req.params.groupId });
      return res.json({ message: 'Group deleted' });
    }

    // If user is creator but others remain, transfer ownership to first member
    if (group.creatorId.toString() === userId.toString() && group.members.length > 0) {
      group.creatorId = group.members[0];
    }

    await group.save();
    
    const io = req.app.get('io');
    if (io) {
      io.to(`group-${req.params.groupId}`).emit('user-left', { 
        userId, 
        userName: req.user.name,
        remainingMembers: group.members.length 
      });
    }

    res.json({ message: 'Left group successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;