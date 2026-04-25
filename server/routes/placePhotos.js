import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/auth.js';
import PlacePhoto from '../models/PlacePhoto.js';

const router = express.Router();

function toPublicDoc(doc) {
  return {
    _id: String(doc._id),
    userId: String(doc.userId),
    placeType: doc.placeType,
    businessId: doc.businessId ? String(doc.businessId) : null,
    placeKey: doc.placeKey,
    placeName: doc.placeName || '',
    lat: Number.isFinite(Number(doc.lat)) ? Number(doc.lat) : null,
    lng: Number.isFinite(Number(doc.lng)) ? Number(doc.lng) : null,
    imageUrl: String(doc.imageUrl || ''),
    visibility: doc.visibility,
    isMine: false,
    createdAt: doc.createdAt
  };
}

router.get('/', protect, async (req, res) => {
  try {
    const placeType = String(req.query.placeType || '').trim();
    if (!['local', 'public'].includes(placeType)) {
      return res.status(400).json({ error: 'placeType must be local or public' });
    }

    let placeKey = '';
    if (placeType === 'local') {
      const businessId = String(req.query.businessId || '').trim();
      if (!businessId || !mongoose.isValidObjectId(businessId)) {
        return res.status(400).json({ error: 'Valid businessId is required for local place photos' });
      }
      placeKey = `local:${businessId}`;
    } else {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const placeName = String(req.query.placeName || '').trim().toLowerCase().slice(0, 80);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: 'Valid lat/lng are required for public place photos' });
      }
      placeKey = `public:${lat.toFixed(5)},${lng.toFixed(5)}:${placeName}`;
    }

    const rows = await PlacePhoto.find({
      placeType,
      placeKey,
      $or: [
        { visibility: 'public' },
        { userId: req.user._id }
      ]
    }).sort({ createdAt: -1 }).limit(30).lean();

    const out = rows.map((r) => {
      const x = toPublicDoc(r);
      x.isMine = String(r.userId) === String(req.user._id);
      return x;
    });
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const placeType = String(req.body?.placeType || '').trim();
    const imageUrl = String(req.body?.imageUrl || '').trim();
    const visibilityRaw = String(req.body?.visibility || 'private').trim().toLowerCase();
    const visibility = visibilityRaw === 'public' ? 'public' : 'private';

    if (!['local', 'public'].includes(placeType)) {
      return res.status(400).json({ error: 'placeType must be local or public' });
    }
    if (!imageUrl.startsWith('/uploads/') && !imageUrl.startsWith('http')) {
      return res.status(400).json({ error: 'imageUrl must be an uploaded file URL' });
    }

    let payload = {
      userId: req.user._id,
      placeType,
      imageUrl,
      visibility,
      placeKey: '',
      placeName: ''
    };

    if (placeType === 'local') {
      const businessId = String(req.body?.businessId || '').trim();
      const placeName = String(req.body?.placeName || '').trim().slice(0, 120);
      if (!businessId || !mongoose.isValidObjectId(businessId)) {
        return res.status(400).json({ error: 'Valid businessId is required for local photos' });
      }
      payload.businessId = businessId;
      payload.placeName = placeName;
      payload.placeKey = `local:${businessId}`;
    } else {
      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      const placeName = String(req.body?.placeName || '').trim().slice(0, 120);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: 'Valid lat/lng are required for public photos' });
      }
      payload.lat = lat;
      payload.lng = lng;
      payload.placeName = placeName;
      payload.placeKey = `public:${lat.toFixed(5)},${lng.toFixed(5)}:${placeName.toLowerCase().slice(0, 80)}`;
    }

    const created = await PlacePhoto.create(payload);
    const out = toPublicDoc(created.toObject());
    out.isMine = true;
    return res.status(201).json(out);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid photo id' });
    }
    const row = await PlacePhoto.findById(id);
    if (!row) return res.status(404).json({ error: 'Photo not found' });
    if (String(row.userId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'You can remove only your own uploads' });
    }
    await row.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
