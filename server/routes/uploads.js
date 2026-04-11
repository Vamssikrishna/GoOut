import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { protect, merchantOnly } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadDir = join(__dirname, '../uploads/merchants');
fs.mkdirSync(uploadDir, { recursive: true });

const allowedMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.bin';
    const safeExt = ext.length <= 8 ? ext : '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (allowedMime.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, WebP, or PDF files are allowed.'));
  }
});

const router = express.Router();

router.post('/merchant-asset', protect, merchantOnly, (req, res) => {
  upload.single('file')(req, res, (err) => {
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

export default router;
