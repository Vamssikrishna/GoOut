import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../api/client';

function formatVisitDateTime(value) {
  if (!value) return 'Not visited yet';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'Not visited yet';
  return dt.toLocaleString();
}

function coordsOf(b) {
  const c = b?.location?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export default function CostComparator({
  userLocation,
  businesses,
  offers = [],
  onComparatorTargets,
  onCompareMapLayers,
  onClearCompareMap,
  onRequestMapTab
}) {
  const [visits, setVisits] = useState([]);
  const [visitStats, setVisitStats] = useState(null);
  const [idA, setIdA] = useState('');
  const [idB, setIdB] = useState('');
  const [intent, setIntent] = useState('local eco-friendly walk safe');
  const [transportMode, setTransportMode] = useState('walking');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [compareResult, setCompareResult] = useState(null);
  const [routesById, setRoutesById] = useState({});
  const [routeLegs, setRouteLegs] = useState(null);
  const [feedbackBiz, setFeedbackBiz] = useState('');
  const [feedbackMatched, setFeedbackMatched] = useState(true);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');

  const withCoords = useMemo(
    () => (businesses || []).filter((b) => coordsOf(b)),
    [businesses]
  );

  useEffect(() => {
    const fetch = () => {
      api.get('/visits').then(({ data }) => setVisits(data)).catch(() => setVisits([]));
      api.get('/visits/stats').then(({ data }) => setVisitStats(data)).catch(() => setVisitStats(null));
    };
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (withCoords.length >= 2 && !idA) setIdA(String(withCoords[0]._id));
  }, [withCoords, idA]);

  useEffect(() => {
    if (withCoords.length >= 2 && !idB) {
      const second = withCoords.find((b) => String(b._id) !== String(idA));
      if (second) setIdB(String(second._id));
    }
  }, [withCoords, idB, idA]);

  const liveOffersPayload = useCallback(() => {
    const want = new Set([idA, idB].filter(Boolean));
    return (offers || []).
    filter((o) => {
      const bid = o?.businessId?._id?.toString?.() || String(o?.businessId || '');
      return want.has(bid);
    }).
    map((o) => ({
      businessId: o?.businessId?._id?.toString?.() || String(o.businessId),
      offerPrice: o.offerPrice
    }));
  }, [offers, idA, idB]);

  const offerSig = useMemo(
    () => liveOffersPayload().map((o) => `${o.businessId}:${o.offerPrice}`).sort().join('|'),
    [liveOffersPayload]
  );

  const runCompare = async () => {
    setError('');
    setCompareResult(null);
    if (!userLocation || !Number.isFinite(userLocation.lat)) {
      setError('Need your location to compare travel time and footprint.');
      return;
    }
    const a = withCoords.find((b) => String(b._id) === String(idA));
    const b = withCoords.find((x) => String(x._id) === String(idB));
    if (!a || !b || String(a._id) === String(b._id)) {
      setError('Pick two different places that have map locations.');
      return;
    }
    setLoading(true);
    try {
      const destA = coordsOf(a);
      const destB = coordsOf(b);
      const [resA, resB] = await Promise.all([
      api.post('/directions/route', {
        origin: userLocation,
        destination: destA,
        profile: transportMode,
        alternatives: false,
        maxAlternatives: 1
      }),
      api.post('/directions/route', {
        origin: userLocation,
        destination: destB,
        profile: transportMode,
        alternatives: false,
        maxAlternatives: 1
      })]
      );
      const rA = resA.data?.routes?.[0];
      const rB = resB.data?.routes?.[0];
      if (!rA || !rB) {
        setError('Could not compute routes for one or both places.');
        return;
      }
      const legs = [
      { businessId: String(a._id), durationSeconds: rA.durationSeconds, distanceMeters: rA.distanceMeters },
      { businessId: String(b._id), durationSeconds: rB.durationSeconds, distanceMeters: rB.distanceMeters }];

      setRoutesById({
        [String(a._id)]: rA,
        [String(b._id)]: rB
      });
      setRouteLegs(legs);
      onComparatorTargets?.([String(a._id), String(b._id)]);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Compare failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!routeLegs || routeLegs.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.post('/compare/value-scores', {
        intent,
        transportMode,
        legs: routeLegs,
        liveOffers: liveOffersPayload()
      }).
      then(({ data }) => {
        if (!cancelled) setCompareResult(data);
      }).
      catch(() => {
        if (!cancelled) setCompareResult(null);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [routeLegs, intent, transportMode, offerSig]);

  const pushMapLayers = () => {
    if (!compareResult?.options?.length) return;
    const topPickId = compareResult.topPickId;
    const overlays = [];
    for (const opt of compareResult.options) {
      const r = routesById[opt.businessId];
      if (!r?.geometryLatLng?.length) continue;
      const isTop = String(opt.businessId) === String(topPickId);
      overlays.push({
        geometryLatLng: r.geometryLatLng,
        strokeColor: isTop ? '#22c55e' : '#94a3b8',
        strokeWeight: isTop ? 6 : 4,
        strokeOpacity: 0.92,
        zIndex: isTop ? 3 : 2
      });
    }
    const versus = {
      topPickId,
      options: compareResult.options.map((o) => ({
        businessId: o.businessId,
        name: o.mapDisplayName || o.name,
        valueScore: o.valueScore,
        benefitScore: o.benefitScore,
        totalCostScore: o.totalCostScore
      }))
    };
    onCompareMapLayers?.({ overlays, versus });
    onRequestMapTab?.();
  };

  const clearMap = () => {
    onClearCompareMap?.();
    setCompareResult(null);
    setRoutesById({});
    setRouteLegs(null);
    onComparatorTargets?.([]);
  };

  const latestVisitByBusinessId = visits.reduce((acc, visit) => {
    const key = visit?.businessId?._id || visit?.businessId;
    if (!key || !visit?.visitedAt) return acc;
    const prev = acc[key];
    if (!prev || new Date(visit.visitedAt).getTime() > new Date(prev).getTime()) {
      acc[key] = visit.visitedAt;
    }
    return acc;
  }, {});

  const submitFeedback = async () => {
    setFeedbackStatus('');
    if (!feedbackBiz) {
      setFeedbackStatus('Choose a place.');
      return;
    }
    try {
      await api.post('/visits/benefit-feedback', {
        businessId: feedbackBiz,
        matched: feedbackMatched,
        note: feedbackNote
      });
      setFeedbackStatus('Thanks — logged for this visit.');
      setFeedbackNote('');
    } catch (e) {
      setFeedbackStatus(e.response?.data?.error || 'Could not save feedback');
    }
  };

  const groupedVisitHistory = useMemo(() => {
    const grouped = visits.reduce((acc, v) => {
      const isPublic = v.placeType === 'public' || !v.businessId;
      const name = isPublic ? v.placeName || 'Public place' : v.businessId?.name || v.placeName || 'Local place';
      const groupKey = isPublic ?
      `public:${String(name).toLowerCase()}` :
      `local:${v.businessId?._id || String(name).toLowerCase()}`;
      if (!acc[groupKey]) {
        acc[groupKey] = {
          key: groupKey,
          name,
          placeType: isPublic ? 'public' : 'local',
          visits: 0,
          latestVisitedAt: v.visitedAt || null
        };
      }
      acc[groupKey].visits += 1;
      if (v.visitedAt && (!acc[groupKey].latestVisitedAt || new Date(v.visitedAt).getTime() > new Date(acc[groupKey].latestVisitedAt).getTime())) {
        acc[groupKey].latestVisitedAt = v.visitedAt;
      }
      return acc;
    }, {});
    return Object.values(grouped).sort((a, b) => new Date(b.latestVisitedAt || 0).getTime() - new Date(a.latestVisitedAt || 0).getTime());
  }, [visits]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-display font-semibold text-lg mb-1">Cost–benefit comparator</h2>
        <p className="text-slate-600 text-sm mb-4">
          We combine visit price (or live flash deal), travel time as ₹ opportunity cost, and a light footprint penalty, then stack sustainability, local impact, Red Pin safety, and reward hints. Say what you care about (e.g. &quot;eco local safe&quot;) to re-weight benefits.
        </p>

        {visitStats && visitStats.totalVisits > 0 &&
        <div className="mb-4 p-4 bg-goout-mint rounded-xl">
            <p className="font-medium text-goout-dark">Location-verified outings</p>
            <p className="text-2xl font-bold text-goout-green mt-1">₹{visitStats.totalSaved} saved vs delivery (historical)</p>
          </div>
        }

        {withCoords.length < 2 ?
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Need at least two nearby merchants with coordinates. Search the map tab first.
          </p> :

        <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-slate-600">Option A</span>
                <select
                value={idA}
                onChange={(e) => setIdA(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">

                  {withCoords.map((b) =>
                <option key={b._id} value={b._id}>{b.mapDisplayName || b.name}</option>
                )}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Option B</span>
                <select
                value={idB}
                onChange={(e) => setIdB(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">

                  {withCoords.map((b) =>
                <option key={b._id} value={b._id}>{b.mapDisplayName || b.name}</option>
                )}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-slate-600">What matters right now (keywords)</span>
              <input
              type="text"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="e.g. eco-friendly, local, budget, safe meetup"
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />

            </label>
            <div className="flex flex-wrap gap-3 items-center">
              <span className="text-sm text-slate-600">Travel mode</span>
              {['walking', 'cycling', 'driving'].map((m) =>
            <button
              key={m}
              type="button"
              onClick={() => setTransportMode(m)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${
              transportMode === m ? 'bg-goout-green text-white' : 'bg-slate-100 text-slate-700'}`
              }>
            
                {m}
              </button>
            )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
              type="button"
              disabled={loading}
              onClick={runCompare}
              className="px-4 py-2 rounded-lg bg-goout-green text-white font-medium hover:bg-goout-accent disabled:opacity-50">

              {loading ? 'Working…' : 'Compare'}
            </button>
              {compareResult &&
            <>
                  <button
                type="button"
                onClick={pushMapLayers}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 font-medium hover:bg-slate-50">

                  Show routes on map
                </button>
                  <button type="button" onClick={clearMap} className="px-4 py-2 rounded-lg text-slate-600 hover:text-slate-900 text-sm">
                    Clear
                  </button>
                </>
            }
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {compareResult &&
          <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">
                  <p className="font-semibold">Smart choice</p>
                  <p className="mt-1">{compareResult.nudge}</p>
                </div>
                {compareResult.tradeoff &&
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-800">
                    <p className="font-semibold text-slate-900">Trade-off</p>
                    <p className="mt-1">{compareResult.tradeoff}</p>
                  </div>
            }
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left">
                        <th className="py-2 pr-2">Place</th>
                        <th className="py-2 pr-2">₹ visit</th>
                        <th className="py-2 pr-2">Time ₹</th>
                        <th className="py-2 pr-2">Env ₹</th>
                        <th className="py-2 pr-2">Benefit</th>
                        <th className="py-2 pr-2">Value</th>
                        <th className="py-2">Rewards hint</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareResult.options.map((o) =>
                  <tr
                    key={o.businessId}
                    className={`border-b border-slate-100 ${
                    String(o.businessId) === String(compareResult.topPickId) ? 'bg-emerald-50/80' : ''}`
                    }>
                    
                        <td className="py-2 pr-2 font-medium">
                          {o.mapDisplayName || o.name}
                          {o.usedFlashPrice && <span className="ml-1 text-xs text-red-700 font-semibold">Flash</span>}
                          {String(o.businessId) === String(compareResult.topPickId) &&
                      <span className="ml-2 text-xs text-emerald-800 font-bold">Top pick</span>
                      }
                        </td>
                        <td className="py-2 pr-2">₹{o.financialInr}</td>
                        <td className="py-2 pr-2">₹{o.timeCostInr}</td>
                        <td className="py-2 pr-2">₹{o.envPenaltyInr}</td>
                        <td className="py-2 pr-2">{o.benefitScore}</td>
                        <td className="py-2 pr-2 font-semibold">{o.valueScore}</td>
                        <td className="py-2 text-xs text-slate-600">
                          ~{o.estimatedCarbonCredits} walk credits · +{o.estimatedSocialPointsHint} social pts (if verified visit)
                        </td>
                      </tr>
                  )}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500">
                  Value score ≈ benefit ÷ (₹ visit + time cost + env penalty). Flash deals refresh scores automatically when offers change.
                </p>
              </div>
          }
          </div>
        }
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="font-display font-semibold text-lg mb-2">After your visit</h3>
        <p className="text-sm text-slate-600 mb-3">
          Did the vibe / safety match what we predicted? Comparator-guided visits can earn carbon credits and social points when GPS confirms you arrived.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <label className="block text-sm flex-1">
            <span className="text-slate-600">Place</span>
            <select
            value={feedbackBiz}
            onChange={(e) => setFeedbackBiz(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">

              <option value="">Select…</option>
              {withCoords.map((b) =>
            <option key={b._id} value={b._id}>{b.mapDisplayName || b.name}</option>
            )}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm shrink-0">
            <input
            type="checkbox"
            checked={feedbackMatched}
            onChange={(e) => setFeedbackMatched(e.target.checked)}
            className="rounded border-slate-300" />

            Benefit matched expectation
          </label>
        </div>
        <textarea
        value={feedbackNote}
        onChange={(e) => setFeedbackNote(e.target.value)}
        placeholder="Optional note"
        rows={2}
        className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />

        <button
        type="button"
        onClick={submitFeedback}
        className="mt-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900">

          Send feedback
        </button>
        {feedbackStatus && <p className="mt-2 text-sm text-slate-600">{feedbackStatus}</p>}
      </div>

      {visits.length > 0 &&
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h3 className="font-display font-semibold text-lg mb-4">Visit history</h3>
          <ul className="space-y-2">
            {groupedVisitHistory.slice(0, 10).map((v) =>
          <li key={v.key} className="flex justify-between py-2 border-b border-slate-100 last:border-0">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{v.name} — {v.visits} {v.visits === 1 ? 'visit' : 'visits'}</p>
                  <p className="text-xs text-slate-500">{formatVisitDateTime(v.latestVisitedAt)}</p>
                </div>
              </li>
          )}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Last visit per merchant (table):{' '}
            {withCoords.slice(0, 5).map((b) =>
          <span key={b._id} className="mr-3">
                {b.name}: {formatVisitDateTime(latestVisitByBusinessId[b._id])}
              </span>
          )}
          </p>
        </div>
      }
    </div>);

}
