import express from 'express';
import Offer from '../models/Offer.js';
import Business from '../models/Business.js';
import AnalyticsHit from '../models/AnalyticsHit.js';
import DailyStats from '../models/DailyStats.js';
import { protect, optionalProtect } from '../middleware/auth.js';

const DEBOUNCE_CLICK_MS = 24 * 60 * 60 * 1000;

const router = express.Router();

router.get('/live', async (req, res) => {
  try {
    const { lng, lat, maxDistance = 5000 } = req.query;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const businesses = await Business.find({
      location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: Number(maxDistance) } }
    }).select('_id');
    const ids = businesses.map((b) => b._id);
    const offers = await Offer.find({
      businessId: { $in: ids },
      isActive: true,
      validUntil: { $gte: new Date() }
    }).populate('businessId', 'name category address location');
    res.json(offers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const FLASH_DEAL_COOLDOWN_MS = 4 * 60 * 60 * 1000;

router.post('/', protect, async (req, res) => {
  try {
    const { businessId, title, description, discountPercent, originalPrice, offerPrice, validUntil, durationMinutes } = req.body;
    const business = await Business.findById(businessId);
    if (!business || business.ownerId.toString() !== req.user._id.toString())
    return res.status(403).json({ error: 'Not authorized' });
    const recent = await Offer.findOne({
      businessId,
      isFlash: true,
      createdAt: { $gte: new Date(Date.now() - FLASH_DEAL_COOLDOWN_MS) }
    });
    if (recent) return res.status(429).json({ error: 'One flash deal per 4 hours. Try again later.' });
    const until = validUntil ?
    new Date(validUntil) :
    new Date(Date.now() + Math.min(1440, Math.max(5, Number(durationMinutes) || 30)) * 60 * 1000);
    const offer = await Offer.create({
      businessId,
      title,
      description,
      discountPercent: discountPercent || 0,
      originalPrice,
      offerPrice,
      validUntil: until,
      isFlash: true
    });
    const populated = await Offer.findById(offer._id).populate('businessId', 'name category address location');
    const io = req.app.get('io');
    if (io) {
      const payload = populated.toObject ? populated.toObject() : populated;
      io.emit('new_deal', payload);
      io.emit('flash_deal_pulse', {
        offerId: payload._id,
        businessId: payload.businessId?._id || payload.businessId,
        validUntil: payload.validUntil
      });
    }
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/stop', protect, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id).populate('businessId', 'ownerId');
    if (!offer || !offer.businessId || offer.businessId.ownerId.toString() !== req.user._id.toString())
    return res.status(403).json({ error: 'Not authorized' });
    offer.isActive = false;
    await offer.save();
    const io = req.app.get('io');
    if (io) io.emit('remove_deal', { offerId: offer._id, businessId: offer.businessId._id });
    res.json(offer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/business/:businessId', async (req, res) => {
  try {
    const offers = await Offer.find({
      businessId: req.params.businessId,
      isActive: true,
      validUntil: { $gte: new Date() }
    }).populate('businessId', 'name category address');
    res.json(offers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/click', optionalProtect, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id).populate('businessId');
    if (!offer || !offer.businessId) return res.status(404).json({ error: 'Offer not found' });
    const visitorKey = req.user?._id?.toString() || `ip-${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const since = new Date(Date.now() - DEBOUNCE_CLICK_MS);
    const recent = await AnalyticsHit.findOne({ businessId: offer.businessId._id, visitorKey, type: 'click', at: { $gte: since } });
    if (!recent) {
      await Business.findByIdAndUpdate(offer.businessId._id, { $inc: { 'analytics.offerClicks': 1 } });
      const today = new Date().toISOString().slice(0, 10);
      await DailyStats.findOneAndUpdate(
        { businessId: offer.businessId._id, date: today },
        { $inc: { offerClicks: 1 } },
        { upsert: true }
      );
      await AnalyticsHit.create({ businessId: offer.businessId._id, visitorKey, type: 'click' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;