import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { protect, merchantOnly } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const merchantUploadDir = join(__dirname, '../uploads/merchants');
const chatUploadDir = join(__dirname, '../uploads/chat');
const avatarUploadDir = join(__dirname, '../uploads/avatars');
fs.mkdirSync(merchantUploadDir, { recursive: true });
fs.mkdirSync(chatUploadDir, { recursive: true });
fs.mkdirSync(avatarUploadDir, { recursive: true });

const allowedMerchantMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

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

const allowedAvatarMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const merchantStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, merchantUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.bin';
    const safeExt = ext.length <= 8 ? ext : '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  }
});

const chatStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, chatUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.bin';
    const safeExt = ext.length <= 8 ? ext : '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  }
});

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.bin';
    const safeExt = ext.length <= 8 ? ext : '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  }
});

const merchantUpload = multer({
  storage: merchantStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (allowedMerchantMime.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, WebP, or PDF files are allowed.'));
  }
});

const chatUpload = multer({
  storage: chatStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for chat media
  fileFilter: (_req, file, cb) => {
    if (allowedChatMime.has(file.mimetype)) return cb(null, true);
    cb(new Error('File type not allowed for chat'));
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (allowedAvatarMime.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, or WebP images are allowed for profile photos.'));
  }
});

function getMimeTypeCategory(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

const router = express.Router();

router.post('/merchant-asset', protect, merchantOnly, (req, res) => {
  merchantUpload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Upload failed';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const url = `/uploads/merchants/${req.file.filename}`;
    return res.json({ url, filename: req.file.filename, mimeType: req.file.mimetype });
  });
});

router.post('/chat-media', protect, (req, res) => {
  chatUpload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Upload failed';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const url = `/uploads/chat/${req.file.filename}`;
    const type = getMimeTypeCategory(req.file.mimetype);
    return res.json({ 
      url, 
      filename: req.file.originalname || req.file.filename,
      mimeType: req.file.mimetype,
      type 
    });
  });
});

router.post('/profile-avatar', protect, (req, res) => {
  avatarUpload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Upload failed';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const url = `/uploads/avatars/${req.file.filename}`;
    return res.json({
      url,
      filename: req.file.originalname || req.file.filename,
      mimeType: req.file.mimetype
    });
  });
});

export default router;
