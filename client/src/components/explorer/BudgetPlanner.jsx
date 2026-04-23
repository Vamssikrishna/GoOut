import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { rankBusinessesForMapSearch, estimateMerchantSpendInr, businessMatchesQueryIntent } from '../../utils/searchMapRank';

export default function BudgetPlanner({ userLocation, businesses: _businesses, onGoToPlace, onBudgetCapSync, onBudgetPathSync }) {
  const { addToast } = useToast();
  const [localMode, setLocalMode] = useState(true);
  const [inputBudget, setInputBudget] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [plan, setPlan] = useState([]);
  const [discoverPlaces, setDiscoverPlaces] = useState([]);
  const [frugalMode, setFrugalMode] = useState(false);
  const [zeroSpend, setZeroSpend] = useState(false);
  const [serverTotal, setServerTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [budgetError, setBudgetError] = useState('');

  const fetchLocalPlan = useCallback(async () => {
    const q = placeQuery.trim();
    if (!userLocation || !q) {
      setPlan([]);
      setFrugalMode(false);
      setZeroSpend(false);
      setServerTotal(null);
      setBudgetError('');
      return;
    }
    const budgetTrim = String(inputBudget).trim();
    if (budgetTrim === '') {
      setPlan([]);
      setServerTotal(null);
      setBudgetError('Enter budget in local mode so results match both search and price.');
      return;
    }
    const n = Number(budgetTrim);
    if (!Number.isFinite(n) || n < 0) {
      setPlan([]);
      setServerTotal(null);
      setBudgetError('Enter a valid non-negative budget.');
      return;
    }
    const budgetNum = n;
    setLoading(true);
    setBudgetError('');
    try {
      const params = { lng: userLocation.lng, lat: userLocation.lat, q };
      const [bRes, bBroadRes] = await Promise.all([
        api.get('/businesses/nearby', { params }),
        api.get('/businesses/nearby', { params: { ...params, q: '' } })
      ]);
      const primary = Array.isArray(bRes.data) ? bRes.data : [];
      const broad = Array.isArray(bBroadRes.data) ? bBroadRes.data : [];
      const relevantBroad = broad.filter((b) => businessMatchesQueryIntent(q, b));
      const byId = new Map();
      [...primary, ...relevantBroad].forEach((b) => {
        const id = String(b?._id || '');
        if (!id || byId.has(id)) return;
        byId.set(id, b);
      });
      const ranked = rankBusinessesForMapSearch([...byId.values()], q, userLocation, { hour: new Date().getHours() });
      const withSpend = ranked
        .map((b) => ({
          ...b,
          spendEstimate: estimateMerchantSpendInr(b),
          // Budget status uses avgPrice when available, else spend estimate.
          budgetCompareValue: Number.isFinite(Number(b?.avgPrice)) && Number(b.avgPrice) > 0 ?
            Number(b.avgPrice) :
            estimateMerchantSpendInr(b),
          inBudget: (
            (Number.isFinite(Number(b?.avgPrice)) && Number(b.avgPrice) > 0 ? Number(b.avgPrice) : estimateMerchantSpendInr(b)) <= budgetNum
          ),
          budgetGap: Math.abs(
            budgetNum - (
              Number.isFinite(Number(b?.avgPrice)) && Number(b.avgPrice) > 0 ? Number(b.avgPrice) : estimateMerchantSpendInr(b)
            )
          )
        }))
        .sort((a, b) => {
          if (a.inBudget !== b.inBudget) return a.inBudget ? -1 : 1;
          if (a.budgetGap !== b.budgetGap) return a.budgetGap - b.budgetGap;
          return (a.distanceMeters || a.distance || 0) - (b.distanceMeters || b.distance || 0);
        })
        .slice(0, 12);

      setPlan(withSpend);
      setFrugalMode(Boolean(budgetNum != null && budgetNum > 0 && budgetNum < 100));
      setZeroSpend(Boolean(budgetNum === 0));
      setServerTotal(withSpend.reduce((s, row) => s + (Number(row.spendEstimate) || 0), 0));
      setDiscoverPlaces([]);
      if (typeof onBudgetCapSync === 'function') {
        onBudgetCapSync(budgetNum);
      }
    } catch (err) {
      setPlan([]);
      setServerTotal(null);
      const msg = String(err?.response?.data?.error || '').trim();
      setBudgetError(msg || 'Budget search failed. Please retry.');
    } finally {
      setLoading(false);
    }
  }, [userLocation, inputBudget, placeQuery, onBudgetCapSync]);

  const fetchDiscoverPlaces = useCallback(() => {
    if (!userLocation) return;
    const q = placeQuery.trim();
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
    if (localMode) {
      const q = placeQuery.trim();
      if (!q) {
        setBudgetError('');
        addToast({ type: 'info', title: 'Describe what you want', message: 'Enter a place type or vibe (e.g. cafe, park), then click Suggest.' });
        return;
      }
      if (String(inputBudget).trim() === '') {
        setBudgetError('Budget is required in local mode.');
        addToast({
          type: 'info',
          title: 'Budget required',
          message: 'Enter your budget so results can match both search and price.'
        });
        return;
      }
      fetchLocalPlan();
    } else {
      fetchDiscoverPlaces();
    }
  };

  useEffect(() => {
    if (!userLocation) return;
    if (!localMode) {
      setPlan([]);
      setFrugalMode(false);
      setBudgetError('');
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

  const displayPlan = localMode ? plan : [];
  const totalCost = displayPlan.reduce((s, b) => {
    const row = b;
    if (row.spendEstimate != null) return s + (Number(row.spendEstimate) || 0);
    return s + (Number(row.avgPrice) || 0);
  }, 0);
  const budgetNumEntered = String(inputBudget).trim() === '' ? null : Number(inputBudget);

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
          'Local mode: Only local places will be shown here' :
          'Public mode: shows public places around you. Use Go to open route to any place.'}
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
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') {
                  setInputBudget('');
                  return;
                }
                const n = Number(v);
                if (!Number.isFinite(n) || n < 0) return;
                setInputBudget(v);
              }}
              min={0}
              max={100000}
              step={50}
              placeholder="e.g. 500 or 0"
              className="px-4 py-2 border border-slate-200 rounded-lg w-40 focus:ring-2 focus:ring-goout-green" />
              <p className="text-xs text-slate-500 mt-1">Must enter the budget</p>
            
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
        {budgetError && localMode && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {budgetError}
          </div>
        )}
        {localMode && zeroSpend && displayPlan.length > 0 &&
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900">
            <strong>Zero-spend mode:</strong> local places are shown with budget status labels.
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
          <p className="text-slate-600 text-sm">Enter the details fast so that i can show the places for you ...</p> :
          Number(inputBudget) < 0 ?
          <p className="text-slate-600 text-sm">Budget cannot be negative.</p> :
          <p className="text-slate-600 text-sm">No GoOut local places match. Try another keyword or remove/tune budget cap.</p>
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
                        {`~₹${s.spendEstimate != null ? Math.round(s.spendEstimate) : s.avgPrice || 0}`}
                        {s.inBudget === false ? ' · Not in budget, try increasing the budget' : ' · In budget'}
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
              {displayPlan.length > 0 && (budgetNumEntered != null || serverTotal != null) &&
              <p className="mt-4 text-sm text-slate-600">
                Trip estimate: ₹{serverTotal != null ? Math.round(serverTotal) : Math.round(totalCost)}
                {budgetNumEntered != null && Number.isFinite(budgetNumEntered) &&
                <>
                  {' '}
                  / ₹{budgetNumEntered}{' '}
                  <span className="text-goout-green font-medium">
                    (₹{Math.max(0, budgetNumEntered - (serverTotal != null ? serverTotal : totalCost))} headroom)
                  </span>
                </>}
              </p>
              }
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