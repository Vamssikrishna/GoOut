import express from 'express';
import Business from '../models/Business.js';

const router = express.Router();

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function matchesCategory(b, term) {
  const c = (b.category || '').toLowerCase();
  const tags = (b.tags || []).map((t) => String(t).toLowerCase());
  const t = term.toLowerCase();
  return c.includes(t) || tags.some((tag) => tag.includes(t));
}

router.get('/itinerary', async (req, res) => {
  try {
    const { lng, lat, budget, preferences, place } = req.query;
    const coords = [parseFloat(lng) || 0, parseFloat(lat) || 0];
    const maxBudget = parseFloat(budget) || 500;
    const queryText = (place || preferences || '').toString().trim();
    const terms = queryText ? queryText.split(/[+,&]/).map((s) => s.trim()).filter(Boolean) : [];

    let plan = [];
    let frugalMode = false;

    if (maxBudget < 50) {
      frugalMode = true;
      const free = await Business.find({
        location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: 5000 } },
        isFree: true
      }).limit(3).populate('ownerId', 'name');
      const freeAny = await Business.find({
        location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: 5000 } },
        $or: [
          { isFree: true },
          { avgPrice: 0 },
          { category: { $regex: /park|library|garden|viewpoint|outdoor|lake/i } }
        ]
      }).limit(5).populate('ownerId', 'name');
      const results = free.length ? free : freeAny;
      const freePlan = results.map((b) => ({
        ...b.toObject(),
        distance: getDistance(coords[1], coords[0], b.location.coordinates[1], b.location.coordinates[0]),
        avgPrice: 0,
        isFree: true
      })).sort((a, b) => a.distance - b.distance);
      plan = terms.length
        ? freePlan.filter((b) => terms.some((t) => matchesCategory(b, t) || (b.name || '').toLowerCase().includes(t.toLowerCase()))).slice(0, 5)
        : freePlan.slice(0, 5);
    } else {
      // Local merchants only, nearest first, and within full user budget.
      const nearby = await Business.find({
        location: { $nearSphere: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: 5000 } },
        avgPrice: { $gte: 0, $lte: maxBudget }
      }).limit(50).populate('ownerId', 'name');

      const normalizedTerm = queryText.toLowerCase();
      const scored = nearby
        .map((b) => {
          const distance = getDistance(coords[1], coords[0], b.location.coordinates[1], b.location.coordinates[0]);
          const category = (b.category || '').toLowerCase();
          const name = (b.name || '').toLowerCase();
          const tags = (b.tags || []).map((t) => String(t).toLowerCase());
          const matchScore = normalizedTerm
            ? (
              (name.includes(normalizedTerm) ? 4 : 0) +
              (category.includes(normalizedTerm) ? 3 : 0) +
              (tags.some((t) => t.includes(normalizedTerm)) ? 2 : 0) +
              (terms.some((t) => matchesCategory(b, t) || name.includes(t.toLowerCase())) ? 1 : 0)
            )
            : 1;
          return { ...b.toObject(), distance, matchScore };
        })
        .filter((b) => b.avgPrice <= maxBudget && (!normalizedTerm || b.matchScore > 0))
        .sort((a, b) => {
          if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
          if (a.distance !== b.distance) return a.distance - b.distance;
          return (a.avgPrice || 0) - (b.avgPrice || 0);
        });

      if (scored.length > 0) {
        plan = scored.slice(0, 8);
      } else {
        // Fallback: nearest local businesses within budget when no strict text match.
        plan = nearby
          .map((b) => ({
            ...b.toObject(),
            distance: getDistance(coords[1], coords[0], b.location.coordinates[1], b.location.coordinates[0]),
            matchScore: 0,
          }))
          .filter((b) => (b.avgPrice || 0) <= maxBudget)
          .sort((a, b) => {
            if (a.distance !== b.distance) return a.distance - b.distance;
            return (a.avgPrice || 0) - (b.avgPrice || 0);
          })
          .slice(0, 8);
      }
    }

    res.json({ plan, frugalMode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
