import express from 'express';
import mongoose from 'mongoose';
import Business from '../models/Business.js';
import { protect } from '../middleware/auth.js';
import {
  scoreMerchantOption,
  rankCompareOptions,
  buildTradeoffNudge
} from '../services/costBenefitEngine.js';

const router = express.Router();

/**
 * POST body:
 * { intent?: string, transportMode?: 'walking'|'driving'|'cycling',
 *   legs: [{ businessId, durationSeconds, distanceMeters }],
 *   liveOffers?: [{ businessId, offerPrice }] }
 */
router.post('/value-scores', protect, async (req, res) => {
  try {
    const {
      intent = '',
      transportMode = 'walking',
      legs = [],
      liveOffers = []
    } = req.body || {};

    if (!Array.isArray(legs) || legs.length < 2) {
      return res.status(400).json({ error: 'Provide at least two legs with businessId, durationSeconds, distanceMeters' });
    }
    if (legs.length > 4) {
      return res.status(400).json({ error: 'Compare at most 4 places at once' });
    }

    const legIds = legs.map((l) => String(l.businessId || ''));
    if (new Set(legIds).size !== legIds.length) {
      return res.status(400).json({ error: 'Each place in a comparison must be unique' });
    }

    const offerMap = new Map();
    (liveOffers || []).forEach((o) => {
      const id = o?.businessId?.toString?.() || String(o?.businessId || '');
      if (id && o.offerPrice != null) offerMap.set(id, Number(o.offerPrice));
    });

    const ids = legs.map((l) => l.businessId).filter(Boolean);
    const objectIds = [];
    for (const id of ids) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: `Invalid business id: ${id}` });
      }
      objectIds.push(new mongoose.Types.ObjectId(id));
    }
    const businesses = await Business.find({ _id: { $in: objectIds } }).lean();
    const byId = new Map(businesses.map((b) => [String(b._id), b]));

    const scored = [];
    for (const leg of legs) {
      const id = String(leg.businessId || '');
      const b = byId.get(id);
      if (!b) {
        return res.status(404).json({ error: `Business not found: ${id}` });
      }
      const offerPrice = offerMap.has(id) ? offerMap.get(id) : undefined;
      scored.push(
        scoreMerchantOption(
          b,
          { durationSeconds: leg.durationSeconds, distanceMeters: leg.distanceMeters },
          intent,
          transportMode,
          offerPrice
        )
      );
    }

    const { sorted, topPickId, top, second } = rankCompareOptions(scored);
    const { nudge, tradeoff } = buildTradeoffNudge(top, second, intent);

    res.json({
      options: sorted,
      topPickId,
      nudge,
      tradeoff,
      transportMode,
      intentEcho: String(intent).slice(0, 200)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
