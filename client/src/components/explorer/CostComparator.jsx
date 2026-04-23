import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';

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

function isRestaurantLike(b) {
  const category = String(b?.category || '').toLowerCase();
  const tags = Array.isArray(b?.tags) ? b.tags.map((t) => String(t).toLowerCase()).join(' ') : '';
  const blob = `${category} ${tags}`;
  return /\b(restaurant|restro|diner|eatery|food|bistro|cafe|coffee|bakery)\b/.test(blob);
}

export default function CostComparator({
  userLocation,
  businesses,
  offers = [],
  destinationPoint = null,
  distanceToDestination = null,
  hasReachedDestination = false,
  arrivedBusinessId = '',
  onComparatorTargets,
  onCompareMapLayers,
  onClearCompareMap,
  onRequestMapTab
}) {
  const { addToast } = useToast();
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
  const [feedbackChoice, setFeedbackChoice] = useState(null);
  const [feedbackSubmittedForVisit, setFeedbackSubmittedForVisit] = useState(false);
  const [feedbackClosing, setFeedbackClosing] = useState(false);
  const [mealInput, setMealInput] = useState('');
  const [mealCompareBusy, setMealCompareBusy] = useState(false);
  const [mealCompareError, setMealCompareError] = useState('');
  const [mealCompareResult, setMealCompareResult] = useState(null);
  const [showAllVisits, setShowAllVisits] = useState(false);

  const restaurantWithCoords = useMemo(
    () => {
      return (businesses || []).filter((b) => coordsOf(b) && isRestaurantLike(b));
    },
    [businesses]
  );

  const withCoords = useMemo(
    () => restaurantWithCoords,
    [restaurantWithCoords]
  );

  const refreshVisits = useCallback(() => {
    api.get('/visits').then(({ data }) => {
      setVisits(Array.isArray(data) ? data : []);
    }).catch(() => {
      setVisits([]);
    });
    api.get('/visits/stats').then(({ data }) => {
      setVisitStats(data || null);
    }).catch(() => {
      setVisitStats(null);
    });
  }, []);

  useEffect(() => {
    refreshVisits();
    const interval = setInterval(refreshVisits, 30000);
    return () => clearInterval(interval);
  }, [refreshVisits]);

  const movedAwayAfterArrival = Boolean(
    hasReachedDestination &&
    arrivedBusinessId &&
    Number.isFinite(Number(distanceToDestination)) &&
    Number(distanceToDestination) > 35
  );

  useEffect(() => {
    if (!movedAwayAfterArrival) {
      setFeedbackChoice(null);
      setFeedbackSubmittedForVisit(false);
      setFeedbackClosing(false);
      return;
    }
    if (!feedbackBiz && arrivedBusinessId) {
      setFeedbackBiz(String(arrivedBusinessId));
    }
  }, [movedAwayAfterArrival, feedbackBiz, arrivedBusinessId]);

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
      setError('Need location first.');
      return;
    }
    const a = withCoords.find((b) => String(b._id) === String(idA));
    const b = withCoords.find((x) => String(x._id) === String(idB));
    if (!a || !b || String(a._id) === String(b._id)) {
      setError('Pick two different spots with pins.');
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
        setError('Route failed for one or both.');
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

  const runMealCompare = async () => {
    setMealCompareError('');
    setMealCompareResult(null);
    const text = mealInput.trim();
    if (!text) {
      setMealCompareError('What did you order?');
      return;
    }
    if (!hasReachedDestination || !arrivedBusinessId) {
      setMealCompareError('Arrive at a local spot first.');
      return;
    }
    const ids = [arrivedBusinessId, idA, idB].filter(Boolean);
    const uniqIds = Array.from(new Set(ids.map(String)));
    const compareIds = uniqIds.slice(0, 2);
    if (!compareIds.includes(String(arrivedBusinessId)) && String(arrivedBusinessId)) {
      compareIds[0] = String(arrivedBusinessId);
    }
    if (compareIds.length < 1) {
      setMealCompareError('Pick at least one place.');
      return;
    }
    setMealCompareBusy(true);
    try {
      const { data } = await api.post('/compare/meal-price-compare', {
        text,
        businessIds: compareIds,
        localBusinessId: String(arrivedBusinessId)
      });
      setMealCompareResult(data);
      const savedNow = Math.max(0, Math.round(Number(data?.scenarioEstimates?.savingsVsDelivery || 0)));
      if (savedNow > 0) {
        addToast({
          type: 'success',
          title: 'Saved',
          message: `₹${savedNow} vs Swiggy/Zomato estimate.`
        });
      }
      refreshVisits();
    } catch (e) {
      setMealCompareError(e.response?.data?.error || e.message || 'Could not compare meal prices');
    } finally {
      setMealCompareBusy(false);
    }
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
      setFeedbackStatus('Thanks — logged.');
      setFeedbackNote('');
      setFeedbackClosing(true);
      setFeedbackSubmittedForVisit(true);
      setTimeout(() => {
        setFeedbackChoice(null);
        setFeedbackStatus('');
        setFeedbackClosing(false);
      }, 420);
    } catch (e) {
      setFeedbackStatus(e.response?.data?.error || 'Could not save feedback');
    }
  };

  const visitHistoryRows = useMemo(
    () =>
      (visits || [])
        .map((v, idx) => {
          const isPublic = v.placeType === 'public' || !v.businessId;
          const name = isPublic ? v.placeName || 'Public place' : v.businessId?.name || v.placeName || 'Local place';
          return {
            key: `${v._id || idx}`,
            name,
            placeType: isPublic ? 'public' : 'local',
            visitedAt: v.visitedAt || null
          };
        })
        .sort((a, b) => new Date(b.visitedAt || 0).getTime() - new Date(a.visitedAt || 0).getTime()),
    [visits]
  );

  const activeDestinationName = String(destinationPoint?.label || '').trim();
  const liveDistanceLabel = Number.isFinite(Number(distanceToDestination)) ?
    (Number(distanceToDestination) < 1000 ?
      `${Math.round(Number(distanceToDestination))} m away` :
      `${(Number(distanceToDestination) / 1000).toFixed(2)} km away`) :
    'Tracking distance...';
  const journeySteps = [
    { key: 'go', label: 'Go clicked', done: Boolean(destinationPoint) },
    { key: 'track', label: 'Live tracking', done: Boolean(destinationPoint && Number.isFinite(Number(distanceToDestination))) },
    { key: 'reach', label: 'Reached', done: hasReachedDestination },
    { key: 'feedback', label: 'Feedback', done: feedbackSubmittedForVisit }
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-semibold text-lg text-slate-900">Compare Journey</h2>
            <p className="text-sm text-slate-600 mt-1">
              Go to a place, track live, confirm arrival, then collect feedback + meal savings.
            </p>
          </div>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border ${
            hasReachedDestination ?
              'bg-emerald-100 text-emerald-800 border-emerald-300' :
              'bg-amber-50 text-amber-800 border-amber-200'
          }`}>
            {hasReachedDestination ? 'Reached destination' : 'In journey'}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {journeySteps.map((step) => (
            <div
              key={step.key}
              className={`rounded-xl border px-3 py-2 text-sm ${
                step.done ?
                  'border-emerald-300 bg-emerald-50 text-emerald-900' :
                  'border-slate-200 bg-white text-slate-600'
              }`}
            >
              <p className="font-semibold">{step.done ? 'Done' : 'Pending'}</p>
              <p className="text-xs mt-0.5">{step.label}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          {!destinationPoint ? (
            <p>Tap Go on any local/public pin to begin live route tracking.</p>
          ) : !hasReachedDestination ? (
            <p>
              Heading to <strong>{activeDestinationName || 'selected place'}</strong> · {liveDistanceLabel}
            </p>
          ) : !movedAwayAfterArrival ? (
            <p>You&apos;ve reached <strong>{activeDestinationName || 'this place'}</strong>, enjoy.</p>
          ) : (
            <p>You moved away from the place. Leave quick feedback to help local business growth.</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-display font-semibold text-lg">Plan Compare</h3>
            <p className="text-slate-600 text-sm">Pick two local options and compute value before you go.</p>
          </div>
          {visitStats && visitStats.totalVisits > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Saved so far</p>
              <p className="text-lg font-bold text-emerald-900">₹{visitStats.totalSaved}</p>
            </div>
          )}
        </div>

        {withCoords.length < 2 ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Need 2+ food spots on the map. Search first.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-slate-600">Option A</span>
                <select
                  value={idA}
                  onChange={(e) => setIdA(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                >
                  {withCoords.map((b) => (
                    <option key={b._id} value={b._id}>{b.mapDisplayName || b.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Option B</span>
                <select
                  value={idB}
                  onChange={(e) => setIdB(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                >
                  {withCoords.map((b) => (
                    <option key={b._id} value={b._id}>{b.mapDisplayName || b.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-slate-600">Priorities (keywords)</span>
              <input
                type="text"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="eco, budget, safe…"
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </label>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm text-slate-600">Travel mode</span>
              {['walking'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTransportMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${
                    transportMode === m ? 'bg-goout-green text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={runCompare}
                className="px-4 py-2 rounded-lg bg-goout-green text-white font-medium hover:bg-goout-accent disabled:opacity-50"
              >
                {loading ? 'Working…' : 'Compare'}
              </button>
              {compareResult && (
                <>
                  <button
                    type="button"
                    onClick={pushMapLayers}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 font-medium hover:bg-slate-50"
                  >
                    Map routes
                  </button>
                  <button type="button" onClick={clearMap} className="px-4 py-2 rounded-lg text-slate-600 hover:text-slate-900 text-sm">
                    Clear
                  </button>
                </>
              )}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}

            {compareResult && (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">
                  <p className="font-semibold">Top pick</p>
                  <p className="mt-1">{compareResult.nudge}</p>
                </div>
                {compareResult.tradeoff && (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-800">
                    <p className="font-semibold text-slate-900">Tradeoff</p>
                    <p className="mt-1">{compareResult.tradeoff}</p>
                  </div>
                )}
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
                      {compareResult.options.map((o) => (
                        <tr
                          key={o.businessId}
                          className={`border-b border-slate-100 ${
                            String(o.businessId) === String(compareResult.topPickId) ? 'bg-emerald-50/80' : ''
                          }`}
                        >
                          <td className="py-2 pr-2 font-medium">
                            {o.mapDisplayName || o.name}
                            {o.usedFlashPrice && <span className="ml-1 text-xs text-red-700 font-semibold">Flash</span>}
                            {String(o.businessId) === String(compareResult.topPickId) && (
                              <span className="ml-2 text-xs text-emerald-800 font-bold">Top pick</span>
                            )}
                          </td>
                          <td className="py-2 pr-2">₹{o.financialInr}</td>
                          <td className="py-2 pr-2">₹{o.timeCostInr}</td>
                          <td className="py-2 pr-2">₹{o.envPenaltyInr}</td>
                          <td className="py-2 pr-2">{o.benefitScore}</td>
                          <td className="py-2 pr-2 font-semibold">{o.valueScore}</td>
                          <td className="py-2 text-xs text-slate-600">
                            ~{o.estimatedCarbonCredits} credits · +{o.estimatedSocialPointsHint} social (verified)
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500">
                  Score ≈ benefit ÷ (visit + time + env). Flash updates offers.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="font-display font-semibold text-lg mb-2">Post-Visit Feedback</h3>
        <p className="text-sm text-slate-600 mb-3">
          {movedAwayAfterArrival ?
            'You moved away from the place. Share quick feedback — it helps local business growth.' :
            'Feedback unlocks after you arrive and move away from the place.'}
        </p>
        {!movedAwayAfterArrival && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Step 1: reach destination. Step 2: move away from the pin.
          </div>
        )}
        {movedAwayAfterArrival && !feedbackSubmittedForVisit && feedbackChoice == null && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFeedbackChoice('yes')}
              className="px-4 py-2 rounded-lg bg-goout-green text-white text-sm font-medium hover:bg-goout-accent"
            >
              Leave feedback
            </button>
            <button
              type="button"
              onClick={() => {
                setFeedbackChoice('no');
                setFeedbackStatus('No feedback submitted.');
              }}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
            >
              Skip
            </button>
          </div>
        )}
        {movedAwayAfterArrival && !feedbackSubmittedForVisit && feedbackChoice === 'yes' && (
          <div className={`transition-all duration-500 ease-out ${feedbackClosing ? 'opacity-0 -translate-y-2 pointer-events-none' : 'opacity-100 translate-y-0'}`}>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <label className="block text-sm flex-1">
                <span className="text-slate-600">Place</span>
                <select
                  value={feedbackBiz}
                  onChange={(e) => setFeedbackBiz(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                >
                  <option value="">Select…</option>
                  {withCoords.map((b) => (
                    <option key={b._id} value={b._id}>{b.mapDisplayName || b.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm shrink-0">
                <input
                  type="checkbox"
                  checked={feedbackMatched}
                  onChange={(e) => setFeedbackMatched(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Met expectations
              </label>
            </div>
            <textarea
              value={feedbackNote}
              onChange={(e) => setFeedbackNote(e.target.value)}
              placeholder="What was good or what can improve?"
              rows={2}
              className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={submitFeedback}
              className="mt-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900"
            >
              Send feedback
            </button>
          </div>
        )}
        {feedbackSubmittedForVisit && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Feedback sent to merchant email. Thanks for helping local business.
          </div>
        )}
        {feedbackStatus && <p className="mt-2 text-sm text-slate-600">{feedbackStatus}</p>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-3">
        <h3 className="font-display font-semibold text-lg">Meal Price Reality Check</h3>
        <p className="text-xs text-slate-600">
          Tell what you ate. We total local menu prices and compare against Swiggy/Zomato estimate.
        </p>
        {!hasReachedDestination && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Reach a place first to unlock meal comparison.
          </div>
        )}
        <textarea
          value={mealInput}
          onChange={(e) => setMealInput(e.target.value)}
          placeholder="e.g. 1 cappuccino, 1 garlic bread, 2 samosa"
          rows={2}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
        />
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={runMealCompare}
            disabled={mealCompareBusy || !hasReachedDestination || !arrivedBusinessId}
            className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium disabled:opacity-60"
          >
            {mealCompareBusy ? 'Checking…' : 'Compare meals'}
          </button>
          {mealCompareResult?.aiModel && <span className="text-xs text-slate-500">AI: {mealCompareResult.aiModel}</span>}
        </div>
        {mealCompareError && <p className="text-xs text-red-600">{mealCompareError}</p>}
        {mealCompareResult?.comparisons?.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              Parsed items: {(mealCompareResult.parsedItems || []).map((x) => `${x.qty}× ${x.name}`).join(', ')}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-2 pr-2">Place</th>
                    <th className="py-2 pr-2">Estimated total</th>
                    <th className="py-2">Matched items</th>
                  </tr>
                </thead>
                <tbody>
                  {mealCompareResult.comparisons.map((c, idx) => (
                    <tr key={c.businessId} className={`border-b border-slate-100 ${idx === 0 ? 'bg-emerald-50/80' : ''}`}>
                      <td className="py-2 pr-2 font-medium">{c.name}</td>
                      <td className="py-2 pr-2">₹{Math.round(Number(c.estimatedTotalInr) || 0)}</td>
                      <td className="py-2 text-xs text-slate-600">
                        {(c.lines || []).slice(0, 4).map((l) => `${l.qty}× ${l.matchedName || l.asked} (₹${Math.round(Number(l.unitPrice) || 0)})`).join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mealCompareResult?.scenarioEstimates && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 space-y-1">
                <p className="font-semibold text-slate-900">Same meal elsewhere</p>
                <p>Local: ₹{Math.round(Number(mealCompareResult.scenarioEstimates.localShopTotal || 0))}</p>
                <p>Swiggy/Zomato (est.): ₹{Math.round(Number(mealCompareResult.scenarioEstimates.deliveryTotal || 0))} (−₹{Math.round(Number(mealCompareResult.scenarioEstimates.savingsVsDelivery || 0))})</p>
                <p>Casual: ₹{Math.round(Number(mealCompareResult.scenarioEstimates.basicRestaurantTotal || 0))} (−₹{Math.round(Number(mealCompareResult.scenarioEstimates.savingsVsBasicRestaurant || 0))})</p>
                <p>Fine: ₹{Math.round(Number(mealCompareResult.scenarioEstimates.highClassRestaurantTotal || 0))} (−₹{Math.round(Number(mealCompareResult.scenarioEstimates.savingsVsHighClassRestaurant || 0))})</p>
                {mealCompareResult.visitSaved && (
                  <p className="text-emerald-700 font-medium">Visit logged.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="font-display font-semibold text-lg mb-4">Visit History</h3>
        {!visitHistoryRows.length ? (
          <p className="text-sm text-slate-600">No visits logged yet.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {(showAllVisits ? visitHistoryRows : visitHistoryRows.slice(0, 4)).map((v) => (
                <li key={v.key} className="flex justify-between py-2 border-b border-slate-100 last:border-0 gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{v.name}</p>
                    <p className="text-xs text-slate-500 capitalize">{v.placeType} place</p>
                  </div>
                  <p className="text-xs text-slate-500 shrink-0">{formatVisitDateTime(v.visitedAt)}</p>
                </li>
              ))}
            </ul>
            {visitHistoryRows.length > 4 && (
              <button
                type="button"
                onClick={() => setShowAllVisits((s) => !s)}
                className="mt-3 text-sm font-medium text-goout-green hover:text-goout-accent underline underline-offset-2"
              >
                {showAllVisits ? 'View less' : 'View all'}
              </button>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Last visit:{' '}
              {withCoords.slice(0, 5).map((b) => (
                <span key={b._id} className="mr-3">
                  {b.name}: {formatVisitDateTime(latestVisitByBusinessId[b._id])}
                </span>
              ))}
            </p>
          </>
        )}
      </div>
    </div>);

}
