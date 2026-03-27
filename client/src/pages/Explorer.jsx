import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import api from '../api/client';
import { useVisitMonitor } from '../hooks/useVisitMonitor';
import DiscoveryMap from '../components/explorer/DiscoveryMap';
import BudgetPlanner from '../components/explorer/BudgetPlanner';
import CostComparator from '../components/explorer/CostComparator';
import GreenMode from '../components/explorer/GreenMode';
import CityConcierge from '../components/explorer/CityConcierge';
import { useToast } from '../context/ToastContext';

const DEFAULT_CENTER = { lat: 28.6139, lng: 77.2090 };

export default function Explorer() {
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [mapCenter, setMapCenter] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [offers, setOffers] = useState([]);
  const [poiResults, setPoiResults] = useState([]);
  const [activeTab, setActiveTab] = useState('map');
  const { addToast } = useToast();
  const [isSearching, setIsSearching] = useState(false);

  const [directionsRoutes, setDirectionsRoutes] = useState([]);
  const [selectedDirectionsRouteIndex, setSelectedDirectionsRouteIndex] = useState(0);
  const [directionsDestinationLabel, setDirectionsDestinationLabel] = useState('');
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [destinationPoint, setDestinationPoint] = useState(null);
  const [distanceToDestination, setDistanceToDestination] = useState(null);
  const [hasReachedDestination, setHasReachedDestination] = useState(false);
  const [highlightedBusinessId, setHighlightedBusinessId] = useState(null);

  const userLocationRef = useRef(userLocation);
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  // All results are based on current anchor: user location or map center
  const fetchNearby = useCallback(async ({ query = categorySearch.trim(), showToast = false } = {}) => {
    const anchor = mapCenter || userLocation;
    if (!anchor) return;
    const normalizedQuery = query.trim();
    try {
      setIsSearching(true);
      if (showToast) {
        addToast({
          type: 'info',
          title: 'Searching places',
          message: normalizedQuery ? `Finding results for "${normalizedQuery}"...` : 'Refreshing nearby places...',
        });
      }
      const params = { lng: anchor.lng, lat: anchor.lat };
      if (normalizedQuery) {
        params.maxDistance = 50000;
        const term = normalizedQuery;
        if (term.includes(' ')) params.q = term;
        else params.category = term;
      } else {
        params.maxDistance = 5000;
      }
      const [bRes, oRes, poiRes] = await Promise.all([
        api.get('/businesses/nearby', { params }),
        api.get('/offers/live', { params: { lng: anchor.lng, lat: anchor.lat } }),
        normalizedQuery
          ? api.get('/geocode/poi', { params: { lat: anchor.lat, lng: anchor.lng, q: normalizedQuery, radius: 50000 } })
          : Promise.resolve({ data: [] }),
      ]);
      setBusinesses(bRes.data);
      setOffers(oRes.data);
      setPoiResults(poiRes.data || []);
      if (showToast) {
        const total = (bRes.data?.length || 0) + (poiRes.data?.length || 0);
        addToast({ type: 'success', title: 'Search complete', message: `${total} places found.` });
      }
    } catch (e) {
      console.error(e);
      if (showToast) addToast({ type: 'error', title: 'Search failed', message: 'Could not load places. Please retry.' });
    } finally {
      setIsSearching(false);
    }
  }, [mapCenter?.lng, mapCenter?.lat, userLocation?.lng, userLocation?.lat, categorySearch, addToast]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const loc = { lat: p.coords.latitude, lng: p.coords.longitude };
          setUserLocation(loc);
          setMapCenter(loc);
          setLocationError(false);
          addToast({ type: 'success', title: 'Location accessed', message: 'Using your GPS location.' });
        },
        async () => {
          try {
            const { data } = await api.get('/geocode/ip-location');
            setUserLocation(data);
            setMapCenter(data);
            setLocationError(false);
            addToast({ type: 'info', title: 'Location accessed', message: 'GPS denied/unavailable. Using approximate IP location.' });
          } catch {
            setUserLocation(DEFAULT_CENTER);
            setMapCenter(DEFAULT_CENTER);
      setLocationError(true);
            addToast({ type: 'error', title: 'Location not available', message: 'Unable to get location. Using default area.' });
          }
        }
      );
    } else {
      setUserLocation(DEFAULT_CENTER);
      setMapCenter(DEFAULT_CENTER);
      setLocationError(true);
      addToast({ type: 'error', title: 'Location not supported', message: 'Geolocation is not available in this browser.' });
    }
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude };
        setUserLocation(loc);
        setMapCenter(loc);
        setLocationError(false);
        addToast({ type: 'success', title: 'Location updated', message: 'Using your GPS location.' });
      },
      () => {
        api.get('/geocode/ip-location').then(({ data }) => {
          setUserLocation(data);
          setMapCenter(data);
          setLocationError(false);
          addToast({ type: 'info', title: 'Location updated', message: 'Using approximate IP location.' });
        }).catch(() => setLocationError(true));
      }
    );
  };

  const haversineMeters = useCallback((la1, lo1, la2, lo2) => {
    const R = 6371e3;
    const phi1 = (la1 * Math.PI) / 180;
    const phi2 = (la2 * Math.PI) / 180;
    const dPhi = ((la2 - la1) * Math.PI) / 180;
    const dLambda = ((lo2 - lo1) * Math.PI) / 180;
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, []);

  const loadRouteTo = useCallback(
    async ({ lat, lng, label, profile = 'driving' }) => {
      const origin = userLocationRef.current;
      if (!origin || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setDirectionsLoading(true);
      try {
        const { data } = await api.post('/directions/route', {
          origin,
          destination: { lat, lng },
          profile,
          alternatives: true,
        });
        const routes = Array.isArray(data?.routes) ? data.routes : [];
        setDirectionsDestinationLabel(label || '');
        setDirectionsRoutes(routes);
        setSelectedDirectionsRouteIndex(0);
        setDestinationPoint({ lat, lng });
        setHasReachedDestination(false);
        setDistanceToDestination(haversineMeters(origin.lat, origin.lng, lat, lng));
      } catch (err) {
        console.error(err);
        addToast({ type: 'error', title: 'Directions failed', message: 'Could not compute route. Please try again.' });
      } finally {
        setDirectionsLoading(false);
      }
    },
    [addToast, haversineMeters]
  );

  const handleConciergeCommands = useCallback(
    async (commands) => {
      if (!Array.isArray(commands)) return;
      for (const cmd of commands) {
        if (!cmd || typeof cmd !== 'object') continue;
        if (cmd.type === 'flyTo' && Number.isFinite(cmd.lat) && Number.isFinite(cmd.lng)) {
          setMapCenter({ lat: cmd.lat, lng: cmd.lng });
          continue;
        }
        if (cmd.type === 'highlightMarker') {
          if (cmd.businessId) setHighlightedBusinessId(cmd.businessId);
          if (Number.isFinite(cmd.lat) && Number.isFinite(cmd.lng)) {
            setMapCenter({ lat: cmd.lat, lng: cmd.lng });
          }
          continue;
        }
        if (cmd.type === 'drawRoute') {
          const to = cmd.to || {};
          if (Number.isFinite(to.lat) && Number.isFinite(to.lng)) {
            // eslint-disable-next-line no-await-in-loop
            await loadRouteTo({ lat: to.lat, lng: to.lng, label: to.label || '', profile: cmd.profile || 'walking' });
          }
        }
      }
    },
    [loadRouteTo]
  );

  useEffect(() => {
    fetchNearby({ query: categorySearch.trim(), showToast: false });
    // run only when anchor changes to avoid refresh on each keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapCenter?.lng, mapCenter?.lat, userLocation?.lng, userLocation?.lat]);

  useEffect(() => {
    if (activeTab !== 'map') return;
    const anchor = mapCenter || userLocation;
    if (!anchor) return;
    const q = categorySearch.trim();

    // Dynamic search like maps: debounce typing to avoid request spam.
    const timer = setTimeout(() => {
      if (!q) {
        fetchNearby({ query: '', showToast: false });
        return;
      }
      if (q.length < 2) return;
      fetchNearby({ query: q, showToast: false });
    }, 450);

    return () => clearTimeout(timer);
  }, [categorySearch, activeTab, mapCenter?.lat, mapCenter?.lng, userLocation?.lat, userLocation?.lng, fetchNearby]);

  const applySearch = useCallback(() => {
    fetchNearby({ query: categorySearch.trim(), showToast: true });
  }, [fetchNearby, categorySearch]);

  const handleBudgetGoToPlace = useCallback(
    async ({ lat, lng, label }) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setHighlightedBusinessId(null);
      setActiveTab('map');
      try {
        await loadRouteTo({ lat, lng, label: label || '', profile: 'driving' });
        addToast({
          type: 'success',
          title: 'Route ready',
          message: label ? `Route to ${label}` : 'Directions loaded — see Map tab.',
        });
      } catch (e) {
        // loadRouteTo already toasts on failure
      }
    },
    [loadRouteTo, addToast]
  );

  useEffect(() => {
    const token = localStorage.getItem('goout_token');
    if (!token) return;
    const socket = io(window.location.origin, { auth: { token } });
    socket.on('new_deal', (offer) => {
      setOffers((prev) => (prev.some((o) => o._id === offer._id) ? prev : [...prev, offer]));
    });
    socket.on('flash_deal_pulse', ({ businessId }) => {
      if (!businessId) return;
      addToast({ type: 'info', title: 'Flash deal nearby', message: 'A nearby merchant just activated an instant deal.' });
    });
    socket.on('remove_deal', ({ offerId }) => {
      setOffers((prev) => prev.filter((o) => o._id !== offerId));
    });
    socket.on('crowd-changed', ({ businessId, level }) => {
      setBusinesses((prev) => prev.map((b) => (b._id === businessId ? { ...b, crowdLevel: level } : b)));
    });
    return () => socket.disconnect();
  }, [addToast]);

  useEffect(() => {
    const handler = (e) => {
      const goBtn = e.target.closest('[data-go-route="1"]');
      if (goBtn) {
        e.preventDefault();
        const lat = parseFloat(goBtn.getAttribute('data-lat'));
        const lng = parseFloat(goBtn.getAttribute('data-lng'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const labelEnc = goBtn.getAttribute('data-label') || '';
        const label = labelEnc ? decodeURIComponent(labelEnc) : '';

        (async () => {
          try {
            await loadRouteTo({ lat, lng, label, profile: 'driving' });
            addToast({ type: 'success', title: 'Route ready', message: label ? `Route to ${label}` : 'Directions loaded.' });
          } catch (err) {
            console.error(err);
          }
        })();

        return;
      }

      const el = e.target.closest('[data-crowd-report]');
      if (!el) return;
      e.preventDefault();
      const id = el.getAttribute('data-business-id');
      const level = Number(el.getAttribute('data-level'));
      if (id && level >= 0) api.post(`/businesses/${id}/crowd-report`, { level }).then(() => {}).catch(console.error);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [addToast, loadRouteTo]);

  useVisitMonitor(businesses, userLocation, true);

  const updateLocation = (lat, lng) => {
    const loc = { lat, lng };
    setUserLocation(loc);
    setMapCenter(loc);
  };

  const cancelRoute = () => {
    setDirectionsRoutes([]);
    setSelectedDirectionsRouteIndex(0);
    setDirectionsDestinationLabel('');
    setDirectionsLoading(false);
    setDestinationPoint(null);
    setDistanceToDestination(null);
    setHasReachedDestination(false);
    addToast({ type: 'info', title: 'Route cancelled', message: 'Navigation route removed from map.' });
  };

  useEffect(() => {
    if (!destinationPoint || !navigator.geolocation) return undefined;
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const current = { lat: p.coords.latitude, lng: p.coords.longitude };
        const meters = haversineMeters(current.lat, current.lng, destinationPoint.lat, destinationPoint.lng);
        setDistanceToDestination(meters);
        if (meters <= 80 && !hasReachedDestination) {
          setHasReachedDestination(true);
          addToast({
            type: 'success',
            title: 'Destination reached',
            message: directionsDestinationLabel
              ? `You have reached ${directionsDestinationLabel}.`
              : 'You have reached your destination.',
          });
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 12000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [destinationPoint, hasReachedDestination, haversineMeters, addToast, directionsDestinationLabel]);

  const tabs = [
    { id: 'map', label: 'Map', icon: '🗺️' },
    { id: 'budget', label: 'Budget', icon: '💰' },
    { id: 'compare', label: 'Compare', icon: '📊' },
    { id: 'green', label: 'Green', icon: '🌿' },
    { id: 'ai', label: 'AI Guide', icon: '🤖' },
  ];

  return (
    <div className="space-y-6">
      {locationError && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
          <strong>Using approximate location (IP).</strong> Tap &quot;Use my location&quot; with GPS enabled for accurate results.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display font-bold text-2xl text-goout-dark">Explore</h1>
        <div className="flex gap-2 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === t.id ? 'bg-goout-green text-white' : 'bg-white border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'map' && (
        <div className="space-y-4">
          <p className="text-slate-600 text-sm">Results are based on your location. Nearest places first; priority to local businesses registered on GoOut.</p>
          <div className="flex gap-2 flex-wrap items-center">
            <button type="button" onClick={useMyLocation} className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium hover:bg-goout-accent transition shrink-0">
              📍 Use my location
            </button>
            <input
              type="text"
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              placeholder="Search place, area, or category (e.g. GreenBeans Cafe, hospital, park)"
              className="flex-1 min-w-[200px] px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-goout-green focus:border-transparent"
            />
            <button onClick={applySearch} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition">
              Apply
            </button>
            {categorySearch.trim() && (
              <button onClick={() => { setCategorySearch(''); }} className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm">
                Clear filter
              </button>
            )}
          </div>
          {isSearching && (
            <div className="text-sm text-goout-dark bg-goout-light px-3 py-2 rounded-lg border border-goout-green/30">
              Searching places... fetching latest results
            </div>
          )}
          {!userLocation ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 flex flex-col items-center justify-center h-[500px]">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-goout-green mb-4" />
              <p className="text-slate-600 font-medium">Getting your location…</p>
              <p className="text-slate-500 text-sm mt-2">Location is required. Results are based on where you are; local registered businesses appear first.</p>
            </div>
          ) : (
            <>
              <DiscoveryMap
                userLocation={userLocation}
                mapCenter={mapCenter || userLocation}
                businesses={businesses}
                offers={offers}
                pois={poiResults}
                onLocationChange={updateLocation}
                categoryFilter={categorySearch.trim()}
                directionsRoutes={directionsRoutes}
                selectedDirectionsRouteIndex={selectedDirectionsRouteIndex}
                highlightedBusinessId={highlightedBusinessId}
              />
              {directionsLoading && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                  <h3 className="font-display font-semibold">🧭 Computing directions…</h3>
                </div>
              )}
              {directionsRoutes.length > 0 && !directionsLoading && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display font-semibold">🧭 Routes to {directionsDestinationLabel || 'destination'}</h3>
                      <p className="text-xs text-slate-500 mt-1">Select a route to preview on the map.</p>
                    </div>
                    <button
                      type="button"
                      onClick={cancelRoute}
                      className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                    >
                      Cancel route
                    </button>
                  </div>
                  <div className="flex gap-2 flex-wrap mt-3">
                    {directionsRoutes.slice(0, 4).map((r, idx) => (
                      <button
                        type="button"
                        key={`${r.distanceMeters || 0}-${idx}`}
                        onClick={() => setSelectedDirectionsRouteIndex(idx)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                          idx === selectedDirectionsRouteIndex
                            ? 'bg-goout-green text-white border-goout-green'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        Route {idx + 1}: {Math.round((r.durationSeconds || 0) / 60)} min · {(r.distanceMeters ? r.distanceMeters / 1000 : 0).toFixed(1)} km
                      </button>
                    ))}
                  </div>
                  {distanceToDestination != null && (
                    <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">
                      {hasReachedDestination
                        ? 'Reached destination'
                        : `Distance to destination: ${distanceToDestination < 1000 ? `${Math.round(distanceToDestination)} m` : `${(distanceToDestination / 1000).toFixed(2)} km`}`}
                    </div>
                  )}
                </div>
              )}
              {offers.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                  <h3 className="font-display font-semibold mb-3">🔥 Live Flash Deals Nearby</h3>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {offers.map((o) => (
                      <div key={o._id} className="flex-shrink-0 w-56 p-3 bg-red-50 border border-red-100 rounded-xl">
                        <p className="font-medium text-slate-900">{o.title}</p>
                        <p className="text-sm text-slate-600">{o.businessId?.name}</p>
                        <p className="text-goout-green font-bold mt-1">₹{o.offerPrice}</p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => api.post(`/offers/${o._id}/click`).catch(() => {})}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50"
                          >
                            Save click
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const lat = o?.businessId?.location?.coordinates?.[1];
                              const lng = o?.businessId?.location?.coordinates?.[0];
                              if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                                addToast({ type: 'error', title: 'Route unavailable', message: 'This merchant location is missing.' });
                                return;
                              }
                              await loadRouteTo({ lat, lng, label: o?.businessId?.name || '', profile: 'driving' });
                              addToast({ type: 'success', title: 'Route ready', message: `Route to ${o?.businessId?.name || 'merchant'} loaded.` });
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-goout-green text-white hover:bg-goout-accent"
                          >
                            Go
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {activeTab === 'budget' && (
        <BudgetPlanner userLocation={userLocation} businesses={businesses} onGoToPlace={handleBudgetGoToPlace} />
      )}
      {activeTab === 'compare' && <CostComparator userLocation={userLocation} businesses={businesses} />}
      {activeTab === 'green' && <GreenMode userLocation={userLocation} />}
      {activeTab === 'ai' && <CityConcierge userLocation={userLocation} onMapCommands={handleConciergeCommands} />}
    </div>
  );
}
