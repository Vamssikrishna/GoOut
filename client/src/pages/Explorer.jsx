import { useState, useEffect, useCallback, useRef, useMemo, Component } from 'react';
import { io } from 'socket.io-client';
import api from '../api/client';
import { useVisitMonitor } from '../hooks/useVisitMonitor';
import DiscoveryMap from '../components/explorer/DiscoveryMap';
import CityConciergeChat from '../components/explorer/CityConciergeChat';
import BudgetPlanner from '../components/explorer/BudgetPlanner';
import CostComparator from '../components/explorer/CostComparator';
import GreenMode from '../components/explorer/GreenMode';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import {
  rankBusinessesForMapSearch,
  estimateMerchantSpendInr,
  businessMatchesQueryIntent,
  businessMatchesPreciseQuery,
  poiMatchesPreciseQuery
} from '../utils/searchMapRank';

const DEFAULT_CENTER = { lat: 28.6139, lng: 77.2090 };
const GEO_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
const MAX_ACCEPTABLE_ACCURACY_M = 250;
const TARGET_PRECISE_ACCURACY_M = 25;
const STRICT_ACCEPT_ACCURACY_M = 50;
/** When GPS reports movement beyond this, accept the new fix even if accuracy is slightly worse (walking). */
const SIGNIFICANT_MOVE_M = 25;
const ARRIVAL_THRESHOLD_M = 8;
const USER_LOCATION_CACHE_KEY = 'goout_last_user_location';

class ExplorerSectionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err) {
    console.error('[ExplorerSectionErrorBoundary]', err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This section failed to render. Reload once; map remains available.
        </div>
      );
    }
    return this.props.children;
  }
}



function mergeExplorerPoiLists(searchPois, broadPois) {
  const m = new Map();
  const add = (p) => {
    if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return;
    const k = `${String(p.name || '').toLowerCase().slice(0, 56)}|${Number(p.lat).toFixed(4)}|${Number(p.lng).toFixed(4)}`;
    const prev = m.get(k);
    const d = Number(p.distanceMeters);
    if (
      !prev ||
      (Number.isFinite(d) && (!Number.isFinite(Number(prev.distanceMeters)) || d < Number(prev.distanceMeters)))
    ) {
      m.set(k, p);
    }
  };
  (searchPois || []).forEach(add);
  (broadPois || []).forEach(add);
  return [...m.values()]
    .sort((a, b) => (Number(a.distanceMeters) || 0) - (Number(b.distanceMeters) || 0))
    .slice(0, 450);
}

function poiStableKey(p) {
  if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return '';
  return `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;
}

function haversineMetersRaw(la1, lo1, la2, lo2) {
  const R = 6371e3;
  const phi1 = la1 * Math.PI / 180;
  const phi2 = la2 * Math.PI / 180;
  const dPhi = (la2 - la1) * Math.PI / 180;
  const dLambda = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function readCachedUserLocation() {
  try {
    const raw = localStorage.getItem(USER_LOCATION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.lat);
    const lng = Number(parsed?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function nearestRoutePointIndex(route, current) {
  if (!Array.isArray(route) || route.length < 2 || !current) return 0;
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < route.length; i += 1) {
    const p = route[i];
    const la = Number(Array.isArray(p) ? p[0] : p?.lat);
    const lo = Number(Array.isArray(p) ? p[1] : p?.lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const d = haversineMetersRaw(current.lat, current.lng, la, lo);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function ensureRouteEndsAtDestination(route, destination) {
  if (!route || !destination) return route;
  const dLat = Number(destination.lat);
  const dLng = Number(destination.lng);
  const latlng = Array.isArray(route?.geometryLatLng) ? route.geometryLatLng : [];
  if (!Number.isFinite(dLat) || !Number.isFinite(dLng) || latlng.length === 0) return route;
  const last = latlng[latlng.length - 1];
  const lastLat = Number(Array.isArray(last) ? last[0] : last?.lat);
  const lastLng = Number(Array.isArray(last) ? last[1] : last?.lng);
  const isAlreadyAtDestination =
    Number.isFinite(lastLat) &&
    Number.isFinite(lastLng) &&
    Math.abs(lastLat - dLat) < 1e-6 &&
    Math.abs(lastLng - dLng) < 1e-6;
  if (isAlreadyAtDestination) return route;
  return { ...route, geometryLatLng: [...latlng, [dLat, dLng]] };
}

export default function Explorer() {
  const [userLocation, setUserLocation] = useState(() => readCachedUserLocation());
  const [locationError, setLocationError] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [mapCenter, setMapCenter] = useState(() => readCachedUserLocation());
  const [businesses, setBusinesses] = useState([]);
  const [offers, setOffers] = useState([]);
  const [poiResults, setPoiResults] = useState([]);
  /** When set, that public POI (lat/lng key) is hidden from the map until search changes or user applies again. */
  const [hiddenPoiKey, setHiddenPoiKey] = useState(null);
  const prevSearchTrimRef = useRef('');
  const [activeTab, setActiveTab] = useState('map');
  const { addToast } = useToast();
  const { user } = useAuth();
  const [isSearching, setIsSearching] = useState(false);
  const [showResultsLoader, setShowResultsLoader] = useState(false);

  const [directionsRoutes, setDirectionsRoutes] = useState([]);
  const [selectedDirectionsRouteIndex, setSelectedDirectionsRouteIndex] = useState(0);
  const [directionsDestinationLabel, setDirectionsDestinationLabel] = useState('');
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [destinationPoint, setDestinationPoint] = useState(null);
  const [arrivedBusinessId, setArrivedBusinessId] = useState('');
  const [distanceToDestination, setDistanceToDestination] = useState(null);
  const [initialDistanceToDestination, setInitialDistanceToDestination] = useState(null);
  const [hasReachedDestination, setHasReachedDestination] = useState(false);
  const [pendingArrivalConfirm, setPendingArrivalConfirm] = useState(false);
  const [arrivalEcoImpact, setArrivalEcoImpact] = useState(null);
  const [savingEcoImpact, setSavingEcoImpact] = useState(false);
  const [highlightedBusinessId, setHighlightedBusinessId] = useState(null);
  const [conciergeHighlightBusinessId, setConciergeHighlightBusinessId] = useState(null);
  const [conciergePanTo, setConciergePanTo] = useState(null);
  const [highlightedPoiLatLng, setHighlightedPoiLatLng] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(null);
  const [liveTrackingEnabled, setLiveTrackingEnabled] = useState(false);
  const [locationPinnedByUser, setLocationPinnedByUser] = useState(false);
  const [liveTrackingPoint, setLiveTrackingPoint] = useState(null);
  const [mapBudgetInr, setMapBudgetInr] = useState(null);
  const [budgetPathLatLngs, setBudgetPathLatLngs] = useState(null);
  const [compareRouteOverlays, setCompareRouteOverlays] = useState([]);
  const [compareVersus, setCompareVersus] = useState(null);
  const [greenEcoRoute, setGreenEcoRoute] = useState(null);
  const [currentCity, setCurrentCity] = useState('');
  const lastCityLatLngRef = useRef(null);
  const shouldAutoSearchAfterLocationUpdateRef = useRef(false);

  const fetchCityName = useCallback(async (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    try {
      const { data } = await api.get('/geocode/reverse-city', { params: { lat, lng } });
      if (data?.city) {
        setCurrentCity(data.city);
        lastCityLatLngRef.current = { lat, lng, city: data.city };
        return data.city;
      }
    } catch (e) {
      console.error('Failed to get city:', e);
    }
    return '';
  }, []);

  const visiblePois = useMemo(() => {
    if (!hiddenPoiKey) return poiResults;
    return (poiResults || []).filter((p) => poiStableKey(p) !== hiddenPoiKey);
  }, [poiResults, hiddenPoiKey]);

  const displayDirectionsRoutes = useMemo(() => {
    if (!Array.isArray(directionsRoutes) || directionsRoutes.length === 0 || !liveTrackingPoint) return directionsRoutes;
    return directionsRoutes.map((route, idx) => {
      if (idx !== selectedDirectionsRouteIndex) return route;
      const latlng = Array.isArray(route?.geometryLatLng) ? route.geometryLatLng : [];
      if (latlng.length < 2) return route;
      const nearestIdx = nearestRoutePointIndex(latlng, liveTrackingPoint);
      const remaining = latlng.slice(Math.max(0, nearestIdx));
      if (remaining.length < 2) return route;
      const destLat = Number(destinationPoint?.lat);
      const destLng = Number(destinationPoint?.lng);
      const ensuredTail =
        Number.isFinite(destLat) && Number.isFinite(destLng) ?
          [...remaining, [destLat, destLng]] :
          remaining;
      return {
        ...route,
        geometryLatLng: [[liveTrackingPoint.lat, liveTrackingPoint.lng], ...ensuredTail]
      };
    });
  }, [directionsRoutes, liveTrackingPoint, selectedDirectionsRouteIndex, destinationPoint?.lat, destinationPoint?.lng]);

  const dismissHighlightedPoi = useCallback(() => {
    if (!highlightedPoiLatLng) return;
    const k = poiStableKey({ lat: highlightedPoiLatLng.lat, lng: highlightedPoiLatLng.lng });
    if (k) setHiddenPoiKey(k);
    setHighlightedPoiLatLng(null);
  }, [highlightedPoiLatLng]);

  useEffect(() => {
    const q = categorySearch.trim();
    if (q !== prevSearchTrimRef.current) {
      prevSearchTrimRef.current = q;
      setHiddenPoiKey(null);
    }
  }, [categorySearch]);

  useEffect(() => {
    if (isSearching) return;
    if (!categorySearch.trim()) return;
    setShowResultsLoader(true);
    const t = window.setTimeout(() => setShowResultsLoader(false), 450);
    return () => window.clearTimeout(t);
  }, [businesses, poiResults, isSearching, categorySearch]);

  const userLocationRef = useRef(userLocation);
  const comparatorBusinessIdsRef = useRef(new Set());
  const mapBudgetRef = useRef(null);
  const categorySearchRef = useRef(categorySearch);
  const bestAccuracyRef = useRef(Number.POSITIVE_INFINITY);
  const hasPreciseFixRef = useRef(false);
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  useEffect(() => {
    if (!userLocation) return;
    try {
      localStorage.setItem(USER_LOCATION_CACHE_KEY, JSON.stringify(userLocation));
    } catch {}
  }, [userLocation]);

  useEffect(() => {
    mapBudgetRef.current = mapBudgetInr;
  }, [mapBudgetInr]);

  useEffect(() => {
    categorySearchRef.current = categorySearch;
  }, [categorySearch]);

  const applyGpsFix = useCallback((coords, { recenter = false, force = false } = {}) => {
    if (locationPinnedByUser && !force) return false;
    const lat = Number(coords?.latitude);
    const lng = Number(coords?.longitude);
    const accuracy = Number(coords?.accuracy);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    const hasAccuracy = Number.isFinite(accuracy) && accuracy > 0;
    const acceptable = hasAccuracy && accuracy <= STRICT_ACCEPT_ACCURACY_M;
    const previous = userLocationRef.current;
    const movedMeters = previous ? haversineMetersRaw(previous.lat, previous.lng, lat, lng) : Infinity;
    const improvedFix = hasAccuracy && accuracy < bestAccuracyRef.current;
    const sameOrBetterAccuracy = !hasAccuracy || accuracy <= bestAccuracyRef.current;
    const shouldAccept =
      force ||
      !previous ||
      improvedFix ||
      movedMeters >= SIGNIFICANT_MOVE_M ||
      (acceptable && sameOrBetterAccuracy);
    if (!shouldAccept) return false;

    const loc = { lat, lng };
    setUserLocation(loc);
    if (recenter || !previous) setMapCenter(loc);
    setLocationError(false);
    if (hasAccuracy) {
      setLocationAccuracy(Math.round(accuracy));
      bestAccuracyRef.current = Math.min(bestAccuracyRef.current, accuracy);
      if (accuracy <= TARGET_PRECISE_ACCURACY_M) hasPreciseFixRef.current = true;
    }
    return true;
  }, [locationPinnedByUser]);


  const MIN_SEARCH_LEN = 2;

  const fetchNearby = useCallback(async ({ query = categorySearch.trim(), showToast = false } = {}) => {
    const anchor = mapCenter || userLocation;
    if (!anchor) return;
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < MIN_SEARCH_LEN) {
      setBusinesses([]);
      setPoiResults([]);
      setOffers([]);
      setHighlightedBusinessId(null);
      setHighlightedPoiLatLng(null);
      setHiddenPoiKey(null);
      if (showToast && normalizedQuery.length > 0) {
        addToast({
          type: 'info',
          title: 'Search too short',
          message: `Type at least ${MIN_SEARCH_LEN} characters, then click Apply.`
        });
      }
      return;
    }
    try {
      setIsSearching(true);
      if (showToast) {
        addToast({
          type: 'info',
          title: 'Searching places',
          message: `Finding results for "${normalizedQuery}"...`
        });
      }
      let activeCity = currentCity;
      if (!lastCityLatLngRef.current || haversineMetersRaw(lastCityLatLngRef.current.lat, lastCityLatLngRef.current.lng, anchor.lat, anchor.lng) > 5000) {
        const fetched = await fetchCityName(anchor.lat, anchor.lng);
        if (fetched) activeCity = fetched;
      }

      const params = {
        lng: anchor.lng,
        lat: anchor.lat,
        city: activeCity,
        q: normalizedQuery
      };
      const [bRes, bBroadRes, oRes, poiRes, poiBroadRes] = await Promise.all([
        api.get('/businesses/nearby', { params }),
        api.get('/businesses/nearby', { params: { ...params, q: '' } }),
        api.get('/offers/live', { params: { lng: anchor.lng, lat: anchor.lat, city: activeCity } }),
        api.get('/geocode/poi', { params: { lat: anchor.lat, lng: anchor.lng, q: normalizedQuery, city: activeCity } }),
        api.get('/geocode/poi', { params: { lat: anchor.lat, lng: anchor.lng, q: '', city: activeCity } })
      ]);
      const rawPrimary = Array.isArray(bRes.data) ? bRes.data : [];
      const rawBroad = Array.isArray(bBroadRes.data) ? bBroadRes.data : [];
      const primaryRelevant = normalizedQuery ?
        rawPrimary.filter((b) => businessMatchesPreciseQuery(normalizedQuery, b)) :
        rawPrimary;
      const broadRelevant = normalizedQuery ?
        rawBroad.filter((b) => businessMatchesQueryIntent(normalizedQuery, b) && businessMatchesPreciseQuery(normalizedQuery, b)) :
        rawBroad;
      const businessById = new Map();
      [...primaryRelevant, ...broadRelevant].forEach((b) => {
        const id = String(b?._id || '');
        if (!id) return;
        if (!businessById.has(id)) businessById.set(id, b);
      });
      const rawBusinesses = [...businessById.values()];
      const hour = new Date().getHours();
      const ranked = rankBusinessesForMapSearch(rawBusinesses, normalizedQuery, anchor, { hour });
      setBusinesses(ranked);
      setOffers(oRes.data);
      const primaryPois = Array.isArray(poiRes.data) ? poiRes.data : [];
      const broadPois = Array.isArray(poiBroadRes.data) ? poiBroadRes.data : [];
      const precisePrimaryPois = normalizedQuery ?
        primaryPois.filter((p) => poiMatchesPreciseQuery(normalizedQuery, p)) :
        primaryPois;
      const preciseBroadPois = normalizedQuery ?
        broadPois.filter((p) => poiMatchesPreciseQuery(normalizedQuery, p)) :
        broadPois;
      const pois = mergeExplorerPoiLists(precisePrimaryPois, preciseBroadPois);
      setPoiResults(pois);

      if (ranked.length > 0) {
        setHighlightedBusinessId(null);
        setHighlightedPoiLatLng(null);
      } else if (pois.length > 0) {
        setHighlightedBusinessId(null);
        const filtered = hiddenPoiKey ? pois.filter((p) => poiStableKey(p) !== hiddenPoiKey) : pois;
        const p0 = filtered[0];
        if (p0 && Number.isFinite(p0.lat) && Number.isFinite(p0.lng)) {
          setHighlightedPoiLatLng({ lat: p0.lat, lng: p0.lng });
        } else {
          setHighlightedPoiLatLng(null);
        }
      } else {
        setHighlightedBusinessId(null);
        setHighlightedPoiLatLng(null);
      }
      if (showToast) {
        const total = rawBusinesses.length + pois.length;
        addToast({ type: 'success', title: 'Search complete', message: `${total} places found.` });
      }
    } catch (e) {
      console.error(e);
      if (showToast) addToast({ type: 'error', title: 'Search failed', message: 'Could not load places. Please retry.' });
    } finally {
      setIsSearching(false);
    }
  }, [mapCenter?.lng, mapCenter?.lat, userLocation?.lng, userLocation?.lat, hiddenPoiKey, addToast, currentCity, fetchCityName]);

  useEffect(() => {
    const q = categorySearch.trim();
    if (q.length >= MIN_SEARCH_LEN) return;
    setBusinesses([]);
    setPoiResults([]);
    setOffers([]);
    setHighlightedBusinessId(null);
    setHighlightedPoiLatLng(null);
  }, [categorySearch]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          applyGpsFix(p.coords, { recenter: true, force: true });
          addToast({ type: 'success', title: 'Location accessed', message: 'Using your GPS location.' });
        },
        async () => {
          try {
            const { data } = await api.get('/geocode/ip-location');
            setUserLocation(data);
            setMapCenter(data);
            setLocationError(true);
            setLocationAccuracy(null);
            addToast({ type: 'info', title: 'Location accessed', message: 'GPS denied/unavailable. Using approximate IP location.' });
          } catch {
            setUserLocation(DEFAULT_CENTER);
            setMapCenter(DEFAULT_CENTER);
            setLocationError(true);
            addToast({ type: 'error', title: 'Location not available', message: 'Unable to get location. Using default area.' });
          }
        },
        GEO_OPTIONS
      );
    } else {
      setUserLocation(DEFAULT_CENTER);
      setMapCenter(DEFAULT_CENTER);
      setLocationError(true);
      addToast({ type: 'error', title: 'Location not supported', message: 'Geolocation is not available in this browser.' });
    }
  }, [addToast, applyGpsFix]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocationPinnedByUser(false);
    shouldAutoSearchAfterLocationUpdateRef.current = true;
    hasPreciseFixRef.current = false;
    bestAccuracyRef.current = Number.POSITIVE_INFINITY;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        applyGpsFix(p.coords, { recenter: true, force: true });
        const acc = Number.isFinite(p.coords?.accuracy) ? Math.round(p.coords.accuracy) : null;
        addToast({
          type: 'success',
          title: 'Location updated',
          message: acc ? `GPS lock acquired (accuracy ~${acc}m).` : 'GPS lock acquired.'
        });
      },
      () => {
        api.get('/geocode/ip-location').then(({ data }) => {
          shouldAutoSearchAfterLocationUpdateRef.current = true;
          setUserLocation(data);
          setMapCenter(data);
          setLocationError(true);
          setLocationAccuracy(null);
          addToast({ type: 'info', title: 'Location updated', message: 'Using approximate IP location.' });
        }).catch(() => setLocationError(true));
      },
      GEO_OPTIONS
    );
  };

  const haversineMeters = useCallback((la1, lo1, la2, lo2) => {
    const R = 6371e3;
    const phi1 = la1 * Math.PI / 180;
    const phi2 = la2 * Math.PI / 180;
    const dPhi = (la2 - la1) * Math.PI / 180;
    const dLambda = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, []);

  const formatDistanceLabel = useCallback((meters) => {
    if (!Number.isFinite(meters)) return '';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }, []);

  const loadRouteTo = useCallback(
    async ({ lat, lng, label, profile = 'walking', kind = 'poi', businessId = '' }) => {
      const origin = userLocationRef.current;
      if (!origin || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setCompareRouteOverlays([]);
      setCompareVersus(null);
      setGreenEcoRoute(null);
      setDirectionsLoading(true);
      try {
        const { data } = await api.post('/directions/route', {
          origin,
          destination: { lat, lng },
          profile,
          alternatives: true
        });
        const destination = { lat, lng };
        const routesRaw = Array.isArray(data?.routes) ? data.routes : [];
        const routes = routesRaw.map((r) => ensureRouteEndsAtDestination(r, destination));
        setDirectionsDestinationLabel(label || '');
        setDirectionsRoutes(routes);
        setSelectedDirectionsRouteIndex(0);
        setDestinationPoint({
          lat,
          lng,
          label: label || '',
          kind: kind || 'poi',
          businessId: businessId ? String(businessId) : ''
        });
        setLiveTrackingPoint(null);
        if (kind !== 'local') setArrivedBusinessId('');
        setHasReachedDestination(false);
        setPendingArrivalConfirm(false);
        setArrivalEcoImpact(null);
        setLiveTrackingEnabled(true);
        const startMeters = haversineMeters(origin.lat, origin.lng, lat, lng);
        setInitialDistanceToDestination(startMeters);
        setDistanceToDestination(startMeters);
        return { startDistanceMeters: startMeters };
      } catch (err) {
        console.error(err);
        addToast({ type: 'error', title: 'Directions failed', message: 'Could not compute route. Please try again.' });
        return null;
      } finally {
        setDirectionsLoading(false);
      }
    },
    [addToast, haversineMeters]
  );

  useEffect(() => {
    if (!shouldAutoSearchAfterLocationUpdateRef.current) return;
    shouldAutoSearchAfterLocationUpdateRef.current = false;
    const q = categorySearchRef.current.trim();
    if (q.length < MIN_SEARCH_LEN) return;
    const anchor = mapCenter || userLocation;
    if (!anchor) return;
    fetchNearby({ query: q, showToast: false });
  }, [mapCenter?.lng, mapCenter?.lat, userLocation?.lng, userLocation?.lat, fetchNearby]);

  const applySearch = useCallback(() => {
    setHiddenPoiKey(null);
    setConciergeHighlightBusinessId(null);
    setConciergePanTo(null);
    fetchNearby({ query: categorySearch.trim(), showToast: true });
  }, [fetchNearby, categorySearch]);

  const handleBudgetGoToPlace = useCallback(
    async ({ lat, lng, label }) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      // Remove budget path overlay so only the standard purple route remains.
      setBudgetPathLatLngs(null);
      setHighlightedBusinessId(null);
      setHighlightedPoiLatLng(null);
      setActiveTab('map');
      try {
        const routeInfo = await loadRouteTo({
          lat,
          lng,
          label: label || '',
          profile: 'walking',
          kind: 'local'
        });
        const distanceText = routeInfo?.startDistanceMeters ? ` · ${formatDistanceLabel(routeInfo.startDistanceMeters)}` : '';
        addToast({
          type: 'success',
          title: 'Route ready',
          message: label ? `Route to ${label}${distanceText}` : `Directions loaded${distanceText} — see Map tab.`
        });
      } catch (e) {

      }
    },
    [loadRouteTo, addToast, formatDistanceLabel]
  );

  const handleConciergeGoRoute = useCallback(
    async ({ lat, lng, label, kind, id }) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const origin = userLocationRef.current;
      if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
        addToast({
          type: 'error',
          title: 'Location needed',
          message: 'Allow location (or wait for GPS) so we can draw a route from you to this place.'
        });
        return;
      }
      setActiveTab('map');
      setHighlightedBusinessId(null);
      if (kind === 'local' && id) {
        setConciergeHighlightBusinessId(String(id));
        setHighlightedPoiLatLng(null);
      } else {
        setConciergeHighlightBusinessId(null);
        setHighlightedPoiLatLng({ lat, lng });
      }
      setConciergePanTo(null);
      const routeInfo = await loadRouteTo({
        lat,
        lng,
        label: label || 'Place',
        profile: 'walking',
        kind: kind === 'local' ? 'local' : 'poi',
        businessId: id || ''
      });
      if (routeInfo?.startDistanceMeters != null) {
        const distanceText = ` · ${formatDistanceLabel(routeInfo.startDistanceMeters)}`;
        addToast({
          type: 'success',
          title: 'Walking route',
          message: `${label ? `To ${label}` : 'Route on map'}${distanceText}.`
        });
      }
    },
    [loadRouteTo, addToast, formatDistanceLabel]
  );

  useEffect(() => {
    const token = localStorage.getItem('goout_token');
    if (!token) return;
    const socket = io(window.location.origin, { auth: { token } });
    socket.on('new_deal', (offer) => {
      setOffers((prev) => prev.some((o) => o._id === offer._id) ? prev : [...prev, offer]);
    });
    socket.on('flash_deal_pulse', ({ businessId }) => {
      if (!businessId) return;
      addToast({
        type: 'info',
        title: 'Flash deal nearby',
        message: mapBudgetRef.current != null ?
          'A Red Pin flash deal went live — refreshing the map; it may now fit your budget cap.' :
          'A nearby merchant just activated an instant deal.'
      });
      const q = categorySearchRef.current.trim();
      if (q.length >= MIN_SEARCH_LEN) {
        fetchNearby({ query: q, showToast: false });
      }
    });
    socket.on('business-removed', ({ businessId }) => {
      const id = String(businessId || '');
      if (!id) return;
      setBusinesses((prev) => prev.filter((b) => String(b._id) !== id));
      setOffers((prev) =>
        prev.filter((o) => {
          const bid = o.businessId?._id ?? o.businessId;
          return String(bid) !== id;
        })
      );
      setHighlightedBusinessId((hid) => (hid != null && String(hid) === id ? null : hid));
      setConciergeHighlightBusinessId((hid) => (hid != null && String(hid) === id ? null : hid));
    });
    socket.on('remove_deal', ({ offerId }) => {
      setOffers((prev) => prev.filter((o) => o._id !== offerId));
    });
    socket.on('crowd-changed', ({ businessId, level }) => {
      setBusinesses((prev) => prev.map((b) => b._id === businessId ? { ...b, crowdLevel: level } : b));
    });
    return () => socket.disconnect();
  }, [addToast, fetchNearby]);

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
            const kind = goBtn.getAttribute('data-kind') || 'poi';
            const businessId = goBtn.getAttribute('data-business-id') || '';
            const routeInfo = await loadRouteTo({ lat, lng, label, profile: 'walking', kind, businessId });
            const distanceText = routeInfo?.startDistanceMeters ? ` · ${formatDistanceLabel(routeInfo.startDistanceMeters)}` : '';
            addToast({ type: 'success', title: 'Walking route', message: label ? `Route to ${label}${distanceText}` : `Directions loaded${distanceText}.` });
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
  }, [addToast, loadRouteTo, formatDistanceLabel]);

  useVisitMonitor(businesses, visiblePois, userLocation, true, { comparatorBusinessIdsRef });

  const updateLocation = (lat, lng) => {
    const loc = { lat, lng };
    shouldAutoSearchAfterLocationUpdateRef.current = true;
    setUserLocation(loc);
    setMapCenter(loc);
    setLocationPinnedByUser(true);
    setLocationError(false);
    addToast({
      type: 'success',
      title: 'Exact pin set',
      message: 'Using your selected pin until you tap "Use my location" again.'
    });
  };

  const cancelRoute = () => {
    setDirectionsRoutes([]);
    setSelectedDirectionsRouteIndex(0);
    setDirectionsDestinationLabel('');
    setDirectionsLoading(false);
    setDestinationPoint(null);
    setLiveTrackingPoint(null);
    setArrivedBusinessId('');
    setInitialDistanceToDestination(null);
    setDistanceToDestination(null);
    setHasReachedDestination(false);
    setPendingArrivalConfirm(false);
    setArrivalEcoImpact(null);
    setSavingEcoImpact(false);
    setLiveTrackingEnabled(false);
    setCompareRouteOverlays([]);
    setCompareVersus(null);
    setGreenEcoRoute(null);
    addToast({ type: 'info', title: 'Route cancelled', message: 'Navigation route removed from map.' });
  };

  useEffect(() => {
    if (!destinationPoint || !navigator.geolocation) return undefined;
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const current = { lat: p.coords.latitude, lng: p.coords.longitude };
        setLiveTrackingPoint(current);
        if (liveTrackingEnabled) {
          setUserLocation(current);
        }
        const meters = haversineMeters(current.lat, current.lng, destinationPoint.lat, destinationPoint.lng);
        setDistanceToDestination(meters);
        if (meters <= ARRIVAL_THRESHOLD_M && !hasReachedDestination && !pendingArrivalConfirm) {
          setPendingArrivalConfirm(true);
          addToast({
            type: 'info',
            title: 'Near destination',
            message: 'Confirm arrival to log this visit.'
          });
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [destinationPoint, hasReachedDestination, haversineMeters, addToast, directionsDestinationLabel, liveTrackingEnabled, locationPinnedByUser, pendingArrivalConfirm]);

  const confirmArrival = useCallback(async () => {
    const current = userLocationRef.current;
    if (!destinationPoint || !current) return;
    const meters = haversineMeters(current.lat, current.lng, destinationPoint.lat, destinationPoint.lng);
    if (!Number.isFinite(meters) || meters > ARRIVAL_THRESHOLD_M * 2) {
      addToast({ type: 'error', title: 'Not at place yet', message: 'Move closer to the destination and try again.' });
      return;
    }
    setHasReachedDestination(true);
    setPendingArrivalConfirm(false);
    const walkedMeters = Math.max(0, initialDistanceToDestination ? Number(initialDistanceToDestination) - Number(meters) : 0);
    const isLocal = destinationPoint?.kind === 'local' && destinationPoint?.businessId;
    if (isLocal) {
      setArrivedBusinessId(String(destinationPoint.businessId));
    }
    try {
      const { data } = await api.post('/visits/impact-preview', {
        distanceWalked: walkedMeters,
        businessId: isLocal ? String(destinationPoint.businessId) : '',
        fromComparator: Boolean(isLocal)
      });
      setArrivalEcoImpact({
        distanceWalked: Number(data?.distanceWalked || walkedMeters || 0),
        carCO2SavedGrams: Number(data?.carCO2SavedGrams || 0),
        bikeCO2SavedGrams: Number(data?.bikeCO2SavedGrams || 0),
        caloriesBurned: Number(data?.caloriesBurned || 0),
        carbonCreditsEarned: Number(data?.carbonCreditsEarned || 0),
        placeKind: isLocal ? 'local' : 'public',
        businessId: isLocal ? String(destinationPoint.businessId) : '',
        place: !isLocal ?
          {
            name: destinationPoint?.label || 'Public place',
            category: 'public',
            lat: Number(destinationPoint?.lat),
            lng: Number(destinationPoint?.lng)
          } :
          null,
        lat: Number(current.lat),
        lng: Number(current.lng),
        decision: 'pending'
      });
      addToast({
        type: 'success',
        title: 'Reached',
        message: 'Arrival verified. Review eco impact and choose Save or Not now.'
      });
    } catch {
      setArrivalEcoImpact({
        distanceWalked: Number(walkedMeters || 0),
        carCO2SavedGrams: 0,
        bikeCO2SavedGrams: 0,
        caloriesBurned: 0,
        carbonCreditsEarned: 0,
        placeKind: isLocal ? 'local' : 'public',
        businessId: isLocal ? String(destinationPoint.businessId) : '',
        place: !isLocal ?
          {
            name: destinationPoint?.label || 'Public place',
            category: 'public',
            lat: Number(destinationPoint?.lat),
            lng: Number(destinationPoint?.lng)
          } :
          null,
        lat: Number(current.lat),
        lng: Number(current.lng),
        decision: 'pending'
      });
      addToast({ type: 'success', title: 'Reached', message: 'Arrival confirmed.' });
    }
  }, [destinationPoint, haversineMeters, addToast, initialDistanceToDestination]);

  const saveArrivalEcoComparison = useCallback(async () => {
    if (!arrivalEcoImpact || savingEcoImpact) return;
    setSavingEcoImpact(true);
    try {
      const payload = {
        lat: Number(arrivalEcoImpact.lat),
        lng: Number(arrivalEcoImpact.lng),
        distanceWalked: Number(arrivalEcoImpact.distanceWalked || 0),
        fromComparator: Boolean(arrivalEcoImpact.placeKind === 'local' && arrivalEcoImpact.businessId),
        ecoComparisonSaved: true
      };
      if (arrivalEcoImpact.placeKind === 'local' && arrivalEcoImpact.businessId) {
        payload.businessId = String(arrivalEcoImpact.businessId);
      } else {
        payload.publicPlace = {
          name: arrivalEcoImpact.place?.name || directionsDestinationLabel || 'Public place',
          category: arrivalEcoImpact.place?.category || 'public',
          lat: Number(arrivalEcoImpact.place?.lat),
          lng: Number(arrivalEcoImpact.place?.lng)
        };
      }
      await api.post('/visits/record', payload);
      setArrivalEcoImpact((prev) => (prev ? { ...prev, decision: 'saved' } : prev));
      addToast({
        type: 'success',
        title: 'Eco comparison saved',
        message: 'Saved with calories, carbon credits, and walked distance.'
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Could not save',
        message: err?.response?.data?.error || 'Failed to save this eco comparison.'
      });
    } finally {
      setSavingEcoImpact(false);
    }
  }, [arrivalEcoImpact, savingEcoImpact, addToast, directionsDestinationLabel]);

  const tabs = [
  { id: 'map', label: 'Map' },
  { id: 'budget', label: 'Budget' },
  { id: 'compare', label: 'Compare' },
  { id: 'green', label: 'Green' }];

  const mapUserLocation = userLocation || mapCenter || DEFAULT_CENTER;


  return (
    <div className="space-y-6 goout-animate-in relative">
      <ExplorerSectionErrorBoundary>
        <CityConciergeChat
          userLocation={userLocation}
          userDisplayName={user?.name}
          // explorationRadiusM removed, now relying on city constraint
          greenMode={activeTab === 'green'}
          mapContext={{ businesses, pois: visiblePois, offers }}
          onDiscoveryBudgetHint={({ isZeroSpend }) => {
            if (isZeroSpend) {
              setMapBudgetInr(0);
              addToast({
                type: 'info',
                title: 'Concierge',
                message: 'Zero-spend intent detected — map budget overlay set to ₹0 to highlight free-friendly pins.'
              });
            }
          }}
          onGoRoute={handleConciergeGoRoute}
          onMapPan={(pt) => {
            if (pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)) {
              setConciergePanTo({ lat: pt.lat, lng: pt.lng, panKey: Date.now() });
              setMapCenter({ lat: pt.lat, lng: pt.lng });
              setActiveTab('map');
            } else {
              setConciergePanTo(null);
            }
          }}
          onHighlightBusiness={(id) => setConciergeHighlightBusinessId(id || null)}
        />
      </ExplorerSectionErrorBoundary>
      {locationError &&
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
          <strong>Using approximate location (IP).</strong> Tap &quot;Use my location&quot; with GPS enabled for accurate results.
        </div>
      }
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display font-bold text-2xl md:text-3xl bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
          Explore
        </h1>
        <div className="flex gap-2 flex-wrap p-1 rounded-2xl bg-white/50 border border-slate-200/60 backdrop-blur-sm shadow-sm">
          {tabs.map((t) =>
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`goout-tab-pill ${activeTab === t.id ? 'goout-tab-pill-active' : ''}`}>
            {t.label}
          </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {activeTab === 'map' && (
          <>
            <p className="text-slate-600 text-sm">
              Enter what you want (e.g. quiet cafe, park, pottery) and click <strong className="text-slate-800">Apply</strong> — GoOut merchants and public places load after you search, not before.
            </p>
            {userLocation &&
            <div className={`rounded-lg border px-3 py-2 text-xs ${
            locationAccuracy != null && locationAccuracy <= TARGET_PRECISE_ACCURACY_M ?
            'border-green-200 bg-green-50 text-green-800' :
            'border-amber-200 bg-amber-50 text-amber-800'}`
            }>
                GPS: {locationAccuracy != null ? `~${locationAccuracy}m accuracy` : 'acquiring lock...'}
                {locationAccuracy != null && locationAccuracy > TARGET_PRECISE_ACCURACY_M && ' (move to open sky for higher precision)'}
                {locationError && ' (approximate fallback)'}
              </div>
            }
            <div className="flex gap-2 flex-wrap items-center">
              {mapBudgetInr != null &&
              <button
                type="button"
                onClick={() => {
                  setMapBudgetInr(null);
                  setBudgetPathLatLngs(null);
                }}
                className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 shrink-0">
                Clear budget overlay
              </button>
              }
              <button type="button" onClick={useMyLocation} className="goout-btn-primary py-2 px-4 text-sm shrink-0">
                Use my location
              </button>
              {currentCity && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-sm font-medium shrink-0">
                  📍 Showing places in {currentCity}
                </div>
              )}
              <input
              type="text"
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              placeholder="Search vibe or place (e.g. quiet cafe to work, pottery, park with view)"
              className="flex-1 min-w-[200px] px-4 py-2 border border-cyan-200/60 rounded-lg focus:ring-2 focus:ring-goout-green focus:border-transparent" />
            
              <button
                type="button"
                onClick={applySearch}
                className="goout-btn-ghost py-2 px-4 text-sm border-slate-200 hover:border-emerald-300/50">
                Apply
              </button>
              {categorySearch.trim() &&
            <button
                  onClick={() => {
                    setCategorySearch('');
                    setHiddenPoiKey(null);
                    setConciergeHighlightBusinessId(null);
                    setConciergePanTo(null);
                  }}
                  className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm">
                  Clear filter
                </button>
            }
            </div>
            {isSearching &&
          <div className="text-sm text-goout-dark bg-goout-light px-3 py-2 rounded-lg border border-goout-green/30">
                Searching places... fetching latest results
              </div>
          }
            {!isSearching && categorySearch.trim() && businesses.length === 0 && poiResults.length === 0 &&
          <div
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                No results for &quot;{categorySearch.trim()}&quot;.
              </div>
          }
            {!userLocation &&
          <div className="rounded-2xl border border-cyan-200/60 bg-white/80 backdrop-blur p-12 flex flex-col items-center justify-center h-[500px]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-goout-green mb-4" />
                <p className="text-slate-600 font-medium">Getting your location…</p>
                <p className="text-slate-500 text-sm mt-2">Location is required. Results are based on where you are; local registered businesses appear first.</p>
              </div>
          }
          </>
        )}

        <div className="relative">
          <DiscoveryMap
              userLocation={mapUserLocation}
              mapCenter={mapCenter || mapUserLocation}
              businesses={businesses}
              offers={offers}
              pois={visiblePois}
              // searchRadiusM prop removed for city
              onLocationChange={updateLocation}
              enablePinSelection={false}
              categoryFilter={categorySearch.trim()}
              highlightedPoiLatLng={highlightedPoiLatLng}
              onDismissHighlightedPoi={highlightedPoiLatLng ? dismissHighlightedPoi : undefined}
              userLocationAccuracy={locationAccuracy}
              isSearching={isSearching}
              showResultsLoader={showResultsLoader}
              searchHasNoResults={!isSearching && Boolean(categorySearch.trim()) && businesses.length === 0 && poiResults.length === 0}
              directionsRoutes={displayDirectionsRoutes}
              selectedDirectionsRouteIndex={selectedDirectionsRouteIndex}
              liveTrackingPoint={liveTrackingPoint}
              destinationPoint={destinationPoint}
              highlightedBusinessId={highlightedBusinessId}
              conciergeHighlightBusinessId={conciergeHighlightBusinessId}
              conciergePanTo={conciergePanTo}
              budgetCapInr={mapBudgetInr}
              budgetPathLatLngs={budgetPathLatLngs}
              compareRouteOverlays={compareRouteOverlays}
              compareVersus={compareVersus}
              mapVisualTheme={activeTab === 'green' || greenEcoRoute ? 'green' : 'default'}
              greenEcoRoute={greenEcoRoute}
          />
          {activeTab !== 'map' && (
              <div className="absolute inset-0 z-20 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/98 shadow-inner backdrop-blur-sm p-4 md:p-6">
                <ExplorerSectionErrorBoundary>
                  {activeTab === 'budget' && (
                    <BudgetPlanner
                      userLocation={userLocation}
                      businesses={businesses}
                      onGoToPlace={handleBudgetGoToPlace}
                      onBudgetCapSync={setMapBudgetInr}
                      onBudgetPathSync={setBudgetPathLatLngs}
                    />
                  )}
                  {activeTab === 'compare' && (
                    <CostComparator
                      userLocation={userLocation}
                      businesses={businesses}
                      offers={offers}
                      hasReachedDestination={hasReachedDestination}
                      arrivedBusinessId={arrivedBusinessId}
                      onComparatorTargets={(ids) => {
                        comparatorBusinessIdsRef.current = new Set((ids || []).map(String));
                      }}
                      onCompareMapLayers={({ overlays, versus }) => {
                        setDirectionsRoutes([]);
                        setSelectedDirectionsRouteIndex(0);
                        setDirectionsDestinationLabel('');
                        setDestinationPoint(null);
                        setInitialDistanceToDestination(null);
                        setDistanceToDestination(null);
                        setHasReachedDestination(false);
                        setCompareRouteOverlays(overlays || []);
                        setCompareVersus(versus || null);
                        setGreenEcoRoute(null);
                      }}
                      onClearCompareMap={() => {
                        setCompareRouteOverlays([]);
                        setCompareVersus(null);
                        comparatorBusinessIdsRef.current = new Set();
                      }}
                      onRequestMapTab={() => setActiveTab('map')}
                    />
                  )}
                  {activeTab === 'green' && (
                    <GreenMode
                      userLocation={userLocation}
                      businesses={businesses}
                      onGreenEcoRoute={setGreenEcoRoute}
                      onRequestMapTab={() => setActiveTab('map')}
                    />
                  )}
                </ExplorerSectionErrorBoundary>
              </div>
          )}
        </div>

        {!userLocation && activeTab === 'budget' && (
          <BudgetPlanner
            userLocation={userLocation}
            businesses={businesses}
            onGoToPlace={handleBudgetGoToPlace}
            onBudgetCapSync={setMapBudgetInr}
            onBudgetPathSync={setBudgetPathLatLngs}
          />
        )}
        {!userLocation && activeTab === 'compare' && (
          <CostComparator
            userLocation={userLocation}
            businesses={businesses}
            offers={offers}
                    hasReachedDestination={hasReachedDestination}
                    arrivedBusinessId={arrivedBusinessId}
            onComparatorTargets={(ids) => {
              comparatorBusinessIdsRef.current = new Set((ids || []).map(String));
            }}
            onCompareMapLayers={({ overlays, versus }) => {
              setDirectionsRoutes([]);
              setSelectedDirectionsRouteIndex(0);
              setDirectionsDestinationLabel('');
              setDestinationPoint(null);
              setInitialDistanceToDestination(null);
              setDistanceToDestination(null);
              setHasReachedDestination(false);
              setCompareRouteOverlays(overlays || []);
              setCompareVersus(versus || null);
              setGreenEcoRoute(null);
            }}
            onClearCompareMap={() => {
              setCompareRouteOverlays([]);
              setCompareVersus(null);
              comparatorBusinessIdsRef.current = new Set();
            }}
            onRequestMapTab={() => setActiveTab('map')}
          />
        )}
        {!userLocation && activeTab === 'green' && (
          <GreenMode
            userLocation={userLocation}
            businesses={businesses}
            onGreenEcoRoute={setGreenEcoRoute}
            onRequestMapTab={() => setActiveTab('map')}
          />
        )}

        {activeTab === 'map' && userLocation && (
          <>
            {pendingArrivalConfirm && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center justify-between gap-3">
                <span>Did you reach {directionsDestinationLabel || 'the place'}?</span>
                <div className="flex gap-2">
                  <button type="button" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white" onClick={confirmArrival}>Yes</button>
                  <button type="button" className="px-3 py-1.5 rounded-lg border border-emerald-300" onClick={() => setPendingArrivalConfirm(false)}>Not yet</button>
                </div>
              </div>
            )}
            {arrivalEcoImpact && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 space-y-3">
                <p className="font-semibold">Eco-friendly routing comparison</p>
                <p>
                  Distance walked: {formatDistanceLabel(Number(arrivalEcoImpact.distanceWalked || 0)) || '0 m'} ·
                  Calories burned: {Math.round(Number(arrivalEcoImpact.caloriesBurned || 0))} kcal ·
                  Carbon credits: {Number(arrivalEcoImpact.carbonCreditsEarned || 0).toFixed(1)}
                </p>
                <p>
                  If you used car: {Math.round(Number(arrivalEcoImpact.carCO2SavedGrams || 0))} g CO2 emitted.
                  If you used bike: {Math.round(Number(arrivalEcoImpact.bikeCO2SavedGrams || 0))} g CO2 emitted.
                  You avoided both by walking.
                </p>
                {arrivalEcoImpact?.decision === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveArrivalEcoComparison}
                      disabled={savingEcoImpact}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-60">
                      {savingEcoImpact ? 'Saving...' : 'Save comparison'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setArrivalEcoImpact((prev) => (prev ? { ...prev, decision: 'skipped' } : prev));
                        addToast({
                          type: 'info',
                          title: 'Not saved',
                          message: 'Showing calories, carbon credits, and walked distance without saving.'
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg border border-emerald-300">
                      Don&apos;t save
                    </button>
                  </div>
                )}
                {arrivalEcoImpact?.decision === 'saved' && (
                  <p className="text-xs font-medium text-emerald-800">Saved to your visit history.</p>
                )}
                {arrivalEcoImpact?.decision === 'skipped' && (
                  <p className="text-xs font-medium text-emerald-800">Not saved. Metrics shown for this trip only.</p>
                )}
              </div>
            )}
            {directionsLoading &&
            <div className="goout-soft-card goout-neon-panel rounded-2xl p-4">
              <h3 className="font-display font-semibold">Computing directions...</h3>
            </div>
            }
            {directionsRoutes.length > 0 && !directionsLoading &&
            <div className="goout-soft-card goout-neon-panel rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display font-semibold">Routes to {directionsDestinationLabel || 'destination'}</h3>
                  <p className="text-xs text-slate-500 mt-1">Select a route to preview on the map.</p>
                </div>
                <button
                  type="button"
                  onClick={cancelRoute}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition">
                  Cancel route
                </button>
              </div>
              <div className="flex gap-2 flex-wrap mt-3">
                {directionsRoutes.slice(0, 4).map((r, idx) =>
                <button
                  type="button"
                  key={`${r.distanceMeters || 0}-${idx}`}
                  onClick={() => setSelectedDirectionsRouteIndex(idx)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                  idx === selectedDirectionsRouteIndex ?
                  'bg-goout-green text-white border-goout-green' :
                  'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`
                  }>
                  Route {idx + 1}: {Math.round((r.durationSeconds || 0) / 60)} min · {(r.distanceMeters ? r.distanceMeters / 1000 : 0).toFixed(1)} km
                </button>
                )}
              </div>
              {initialDistanceToDestination != null &&
              <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                Start distance: {formatDistanceLabel(initialDistanceToDestination)}
              </div>
              }
              {distanceToDestination != null &&
              <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">
                {hasReachedDestination ?
                'Reached destination' :
                `Distance to destination: ${distanceToDestination < 1000 ? `${Math.round(distanceToDestination)} m` : `${(distanceToDestination / 1000).toFixed(2)} km`}`}
                {liveTrackingEnabled && !hasReachedDestination ? ' · Live tracking ON' : ''}
              </div>
              }
            </div>
            }
            {offers.length > 0 &&
            <div className="goout-soft-card goout-neon-panel rounded-2xl p-4">
              <h3 className="font-display font-semibold mb-3">Live Flash Deals Nearby</h3>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {offers.map((o) =>
                <div key={o._id} className="flex-shrink-0 w-56 p-3 bg-red-50 border border-red-100 rounded-xl">
                  <p className="font-medium text-slate-900">{o.title}</p>
                  <p className="text-sm text-slate-600">{o.businessId?.name}</p>
                  <p className="text-goout-green font-bold mt-1">₹{o.offerPrice}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => api.post(`/offers/${o._id}/click`).catch(() => {})}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50">
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
                        await loadRouteTo({
                          lat,
                          lng,
                          label: o?.businessId?.name || '',
                          profile: 'walking',
                          kind: 'local',
                          businessId: o?.businessId?._id || ''
                        });
                        addToast({ type: 'success', title: 'Walking route', message: `Route to ${o?.businessId?.name || 'merchant'} loaded.` });
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-goout-green text-white hover:bg-goout-accent">
                      Go
                    </button>
                  </div>
                </div>
                )}
              </div>
            </div>
            }
          </>
        )}
      </div>
    </div>);

}