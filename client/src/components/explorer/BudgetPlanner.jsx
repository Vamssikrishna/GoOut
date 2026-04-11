import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../api/client';
import { estimateMerchantSpendInr } from '../../utils/searchMapRank';

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function BudgetPlanner({ userLocation, businesses, onGoToPlace, onBudgetCapSync, onBudgetPathSync }) {
  const [localMode, setLocalMode] = useState(true);
  const [inputBudget, setInputBudget] = useState(500);
  const [placeQuery, setPlaceQuery] = useState('');
  const [plan, setPlan] = useState([]);
  const [discoverPlaces, setDiscoverPlaces] = useState([]);
  const [frugalMode, setFrugalMode] = useState(false);
  const [zeroSpend, setZeroSpend] = useState(false);
  const [serverTotal, setServerTotal] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchLocalPlan = useCallback(() => {
    const q = placeQuery.trim();
    if (!userLocation || !q) {
      setPlan([]);
      setFrugalMode(false);
      setZeroSpend(false);
      setServerTotal(null);
      return;
    }
    setLoading(true);
    api.
    get('/budget/itinerary', {
      params: {
        lng: userLocation.lng,
        lat: userLocation.lat,
        budget: inputBudget,
        place: q
      }
    }).
    then(({ data }) => {
      setPlan(data.plan || []);
      setFrugalMode(data.frugalMode || false);
      setZeroSpend(Boolean(data.zeroSpend));
      setServerTotal(typeof data.totalEstimatedInr === 'number' ? data.totalEstimatedInr : null);
      setDiscoverPlaces([]);
      if (typeof onBudgetCapSync === 'function') onBudgetCapSync(inputBudget);
    }).
    catch(() => {
      setPlan([]);
      setServerTotal(null);
    }).
    finally(() => setLoading(false));
  }, [userLocation, inputBudget, placeQuery, onBudgetCapSync]);

  const fetchDiscoverPlaces = useCallback(() => {
    if (!userLocation) return;
    const q = placeQuery.trim();
    if (!q) {
      setDiscoverPlaces([]);
      return;
    }
    setLoading(true);
    api.
    get('/geocode/poi', {
      params: {
        lat: userLocation.lat,
        lng: userLocation.lng,
        q,
        radius: 50000
      }
    }).
    then(({ data }) => {
      setDiscoverPlaces(Array.isArray(data) ? data : []);
      setPlan([]);
      setFrugalMode(false);
      setZeroSpend(false);
      setServerTotal(null);
      if (typeof onBudgetPathSync === 'function') onBudgetPathSync(null);
      if (typeof onBudgetCapSync === 'function') onBudgetCapSync(null);
    }).
    catch(() => setDiscoverPlaces([])).
    finally(() => setLoading(false));
  }, [userLocation, placeQuery, onBudgetPathSync, onBudgetCapSync]);

  const runSuggest = () => {
    if (localMode) fetchLocalPlan();else
    fetchDiscoverPlaces();
  };

  useEffect(() => {
    if (!userLocation) return;
    if (!localMode) {
      setPlan([]);
      setFrugalMode(false);
    }

  }, [userLocation?.lng, userLocation?.lat, localMode]);

  useEffect(() => {
    if (!localMode || typeof onBudgetPathSync !== 'function') return;
    const rows = plan.length > 0 ? plan : [];
    const pts = rows.
      map((s) => {
        const c = s?.location?.coordinates;
        if (!Array.isArray(c) || c.length < 2) return null;
        return { lat: c[1], lng: c[0] };
      }).
      filter(Boolean);
    onBudgetPathSync(pts.length >= 2 ? pts : null);
  }, [localMode, plan, onBudgetPathSync]);

  const clientFallback = useMemo(() => {
    if (!localMode || plan.length > 0) return [];
    if (!businesses?.length || !userLocation) return [];
    if (inputBudget < 0) return [];
    const withDist = businesses.map((b) => ({
      ...b,
      distance: getDistance(userLocation.lat, userLocation.lng, b.location?.coordinates?.[1], b.location?.coordinates?.[0])
    }));
    if (inputBudget < 1) {
      return [];
    }
    if (inputBudget < 50) {
      return withDist.filter((b) => b.isFree || (b.avgPrice || 0) === 0).sort((a, b) => a.distance - b.distance).slice(0, 3);
    }
    const paid = withDist.filter((b) => {
      const est = estimateMerchantSpendInr(b);
      return est > 0 && est <= inputBudget * 0.7;
    }).sort((a, b) => a.distance - b.distance);
    return paid.slice(0, 2);
  }, [localMode, plan.length, businesses, userLocation, inputBudget]);

  const displayPlan = localMode ? plan.length > 0 ? plan : clientFallback : [];
  const totalCost = displayPlan.reduce((s, b) => {
    const row = b;
    if (row.spendEstimate != null) return s + Number(row.spendEstimate) || 0;
    return s + estimateMerchantSpendInr(row);
  }, 0);

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-display font-semibold text-lg mb-2">Budget &amp; discovery</h2>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-sm text-slate-600">Mode:</span>
          <button
            type="button"
            onClick={() => setLocalMode(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            localMode ? 'bg-goout-green text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`
            }>
            
            Local mode
          </button>
          <button
            type="button"
            onClick={() => setLocalMode(false)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            !localMode ? 'bg-goout-green text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`
            }>
            
            All places
          </button>
        </div>
        <p className="text-slate-600 text-sm mb-4">
          {localMode ?
          'Local mode: enter what you are looking for and your budget, then click Suggest local places.' :
          'All places: search the wider map (OSM / public POIs). No budget — results are not limited to GoOut listings.'}
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{localMode ? 'What are you looking for?' : 'Search places'}</label>
            <input
              type="text"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSuggest()}
              placeholder={localMode ? 'e.g. quiet cafe to work, $20 for the day, vegan bakery' : 'e.g. hospital, park, mall, restaurant name'}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-goout-green" />
            
          </div>
          {localMode &&
          <div>
              <label className="block text-sm font-medium mb-1">Your budget (₹)</label>
              <input
              type="number"
              value={inputBudget}
              onChange={(e) => setInputBudget(Math.max(0, Number(e.target.value) || 0))}
              min={0}
              max={100000}
              step={50}
              className="px-4 py-2 border border-slate-200 rounded-lg w-36 focus:ring-2 focus:ring-goout-green" />
              <p className="text-xs text-slate-500 mt-1">Use 0 for zero-spend day (parks, libraries, monuments only). You can also write $ or ₹ in the search box.</p>
            
            </div>
          }
          <button
            type="button"
            onClick={runSuggest}
            className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium hover:bg-goout-accent transition">
            
            {localMode ? 'Suggest local places' : 'Search places'}
          </button>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="font-display font-semibold text-lg mb-4">{localMode ? 'Your itinerary' : 'Places near you'}</h3>
        {localMode && zeroSpend && displayPlan.length > 0 &&
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900">
            <strong>Zero-spend mode:</strong> paid GoOut merchants are hidden. Only free public places are listed — pair with a cheap takeaway later if you like.
          </div>
        }
        {localMode && frugalMode && !zeroSpend && displayPlan.length > 0 &&
        <div className="mb-4 p-3 bg-goout-mint rounded-lg text-sm text-goout-dark">
            <strong>Frugal mode:</strong> free and ₹0 listings only — stretch a small budget.
          </div>
        }
        {loading ?
        <p className="text-slate-500 text-sm">Loading...</p> :
        localMode ?
        displayPlan.length === 0 ?
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              {!userLocation ?
          <p className="text-slate-600 text-sm">Enable location to see local suggestions.</p> :
          !placeQuery.trim() ?
          <p className="text-slate-600 text-sm">Enter a place type/name (e.g. cafe, bakery) and click Suggest local places.</p> :
          inputBudget < 0 ?
          <p className="text-slate-600 text-sm">Budget cannot be negative.</p> :
          inputBudget < 50 ?
          <p className="text-slate-600 text-sm">No free places nearby. Try a higher budget.</p> :

          <p className="text-slate-600 text-sm">No GoOut merchants match. Try another keyword or budget, or switch to All places.</p>
          }
            </div> :

        <>
              <ul className="space-y-3">
                {displayPlan.map((s, i) => {
              const c = s?.location?.coordinates;
              const canGo = typeof onGoToPlace === 'function' && Array.isArray(c) && c.length >= 2;
              return (
            <li key={s._id || i} className="flex items-start gap-3 p-3 bg-goout-mint rounded-lg">
                    <span className="flex-shrink-0 w-8 h-8 bg-goout-green text-white rounded-full flex items-center justify-center font-bold text-sm">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{s.name}</p>
                      <p className="text-sm text-slate-600">
                        {s.category}
                        {' · '}
                        {s.isPublicStop ? 'Free · public' : `~₹${s.spendEstimate != null ? Math.round(s.spendEstimate) : s.avgPrice || 0}`}
                        {' · '}
                        {((s.distance || s.distanceMeters || 0) / 1000).toFixed(1)} km
                      </p>
                    </div>
                    {canGo &&
                  <button
                    type="button"
                    onClick={() => onGoToPlace({ lat: c[1], lng: c[0], label: s.name || 'Stop' })}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-white border border-goout-green text-goout-green text-sm font-medium hover:bg-goout-mint">
                    Fly to
                  </button>
                  }
                  </li>
              );
            })}
              </ul>
              <p className="mt-4 text-sm text-slate-600">
                Trip estimate: ₹{serverTotal != null ? Math.round(serverTotal) : Math.round(totalCost)} / ₹{inputBudget}{' '}
                <span className="text-goout-green font-medium">
                  (₹{Math.max(0, inputBudget - (serverTotal != null ? serverTotal : totalCost))} headroom)
                </span>
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Pay-to-stay tip: grab something small at a Red Pin, then walk to a free park from the Map search — totals stay lower and earn walk carbon nudges in Green Mode.
              </p>
            </> :

        discoverPlaces.length === 0 ?
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
            {!userLocation ?
          <p className="text-slate-600 text-sm">Enable location to search nearby places.</p> :

          <p className="text-slate-600 text-sm">Type what you want (e.g. cafe, park) and click Search places.</p>
          }
          </div> :

        <>
            <p className="text-xs text-slate-500 mb-3">Showing public / map results — not limited to GoOut merchants.</p>
            <ul className="space-y-3 max-h-[420px] overflow-y-auto">
              {discoverPlaces.map((p, i) => {
              const canGo =
              typeof onGoToPlace === 'function' &&
              typeof p.lat === 'number' &&
              typeof p.lng === 'number' &&
              Number.isFinite(p.lat) &&
              Number.isFinite(p.lng);
              return (
                <li
                  key={p.id || `${p.lat}-${p.lng}-${i}`}
                  className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  
                    <span className="flex-shrink-0 w-8 h-8 bg-slate-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{p.name}</p>
                      <p className="text-sm text-slate-600 capitalize">
                        {p.category || 'place'}
                        {typeof p.distanceMeters === 'number' ? ` · ${(p.distanceMeters / 1000).toFixed(2)} km` : ''}
                      </p>
                    </div>
                    {canGo &&
                  <button
                    type="button"
                    onClick={() => onGoToPlace({ lat: p.lat, lng: p.lng, label: p.name || 'Destination' })}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-goout-green text-white text-sm font-medium hover:bg-goout-accent transition">
                    
                        Go
                      </button>
                  }
                  </li>);

            })}
            </ul>
          </>
        }
      </div>
    </div>);

}