import { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useLoadScript } from '@react-google-maps/api';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { estimateMerchantSpendInr, businessIsStrongGreen } from '../../utils/searchMapRank';

const DEFAULT_ZOOM = 17;

/** Softer highways, lift parks & paths — Green Mode map tint (indicative, not a data layer). */
const GREEN_MAP_STYLES = [
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ saturation: 35 }, { lightness: -12 }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ saturation: 22 }, { lightness: -8 }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ saturation: -55 }, { lightness: 25 }] },
  { featureType: 'road.arterial', elementType: 'geometry.stroke', stylers: [{ saturation: -35 }, { lightness: 12 }] },
  { featureType: 'transit.line', elementType: 'geometry', stylers: [{ saturation: 10 }, { lightness: -5 }] }
];

const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b1220' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#14532d' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#86efac' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0f172a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1e293b' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#082f49' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#7dd3fc' }] }
];

/** Compact “my location” dot (delivery-app style): white halo, teal fill, center = GPS point. */
function buildUserLocationMarkerIcon(google, size = 22) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <circle cx="12" cy="12" r="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="0.75"/>
  <circle cx="12" cy="12" r="7" fill="#16a34a" stroke="#ffffff" stroke-width="1.25"/>
  <circle cx="12" cy="12" r="2.25" fill="#ffffff"/>
</svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  const half = size / 2;
  return {
    url,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(half, half)
  };
}

const PIN_ICONS = {
  red: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
  blue: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
};

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}

function crowdLabel(level) {
  const n = Number(level);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 33) return 'Quiet';
  if (n < 66) return 'Moderate';
  return 'Crowded';
}

function businessPopupHtml(b, { isHighlighted }) {
  const mapLabel = b?.mapDisplayName || b?.name;
  const name = escapeHtml(mapLabel);
  const category = escapeHtml(b?.category);
  const avgPrice = Number(b?.avgPrice || 0);
  const rating = Number(b?.rating || 0);
  const isRedPin = Boolean(b?.localVerification?.redPin);
  const hasLiveDeal = Boolean(b?.__hasLiveDeal);

  const loc = b?.location?.coordinates || [];
  const lng = loc?.[0];
  const lat = loc?.[1];

  const crowd = crowdLabel(b?.crowdLevel);
  const crowdHtml = crowd ? `<p class="text-xs mt-1">${escapeHtml(crowd)}</p>` : '';
  const address = escapeHtml(b?.address || '');
  const vibe = escapeHtml(b?.vibe || '');
  const tags = Array.isArray(b?.tags) ? b.tags.slice(0, 5).map((t) => escapeHtml(t)).filter(Boolean) : [];
  const tagsHtml = tags.length ? `<p class="text-xs mt-1 text-slate-600">Tags: ${tags.join(' · ')}</p>` : '';
  const ecoFlags = [];
  if (b?.ecoOptions?.plasticFree) ecoFlags.push('Plastic-free');
  if (b?.ecoOptions?.solarPowered) ecoFlags.push('Solar powered');
  if (b?.ecoOptions?.zeroWaste) ecoFlags.push('Zero-waste');
  if (b?.carbonWalkIncentive) ecoFlags.push('Walker incentive');
  const ecoHtml = ecoFlags.length ? `<p class="text-xs mt-1 text-emerald-800">Eco: ${ecoFlags.map((x) => escapeHtml(x)).join(' · ')}</p>` : '';
  const distanceText =
  typeof b?.distanceMeters === 'number' && Number.isFinite(b.distanceMeters) ?
  `<p class="text-xs mt-1 text-slate-500">Distance: ${b.distanceMeters < 1000 ? `${Math.round(b.distanceMeters)} m` : `${(b.distanceMeters / 1000).toFixed(2)} km`}</p>` :
  '';

  const recommendedHtml = isHighlighted ? '<p class="text-xs mt-1 text-purple-700 font-medium">Highlighted match</p>' : '';
  const verifiedHtml = isRedPin ? '<p class="text-xs mt-1 text-red-700 font-medium">🔴 Verified Local (Red Pin)</p>' : '';

  const goLat = Number.isFinite(lat) ? lat : '';
  const goLng = Number.isFinite(lng) ? lng : '';

  const menuPath = String(b?.menuCatalogFileUrl || '').trim();
  const menuAbs =
    typeof window !== 'undefined' && menuPath.startsWith('/')
      ? `${window.location.origin}${menuPath}`
      : menuPath.startsWith('http')
        ? menuPath
        : '';
  const menuLinkHtml = menuAbs
    ? `<p class="mt-2"><a href="${escapeHtml(menuAbs)}" target="_blank" rel="noopener noreferrer" class="text-emerald-700 font-semibold underline hover:text-emerald-900">View menu</a></p>`
    : '';
  const menuAnchorHtml = menuAbs
    ? `<a href="${escapeHtml(menuAbs)}" target="_blank" rel="noopener noreferrer" class="text-emerald-700 font-semibold underline hover:text-emerald-900">View menu</a>`
    : '';

  return `
    <div class="min-w-[200px]">
      <h3 class="font-semibold text-slate-900">Title: ${name}</h3>
      <p class="text-sm text-slate-600">Category: ${category || 'N/A'}</p>
      <p class="text-sm">Average Price: ₹${avgPrice || 0}</p>
      <p class="text-xs mt-1 text-slate-600">Location: ${address || 'Location not available'}</p>
      ${menuAnchorHtml ? `<p class="mt-2">View menu: ${menuAnchorHtml}</p>` : '<p class="mt-2 text-xs text-slate-500">View menu: Not available</p>'}
      <p class="text-xs mt-1 text-slate-500">Rating: ⭐ ${rating.toFixed(1) || '—'}</p>
      ${vibe ? `<p class="text-xs mt-1 text-slate-700">Vibe: ${vibe}</p>` : ''}
      ${verifiedHtml}
      ${recommendedHtml}
      ${crowdHtml}
      ${distanceText}
      ${tagsHtml}
      ${ecoHtml}
      ${/cafe|coffee|grocery|supermarket|bakery|restaurant|bistro|juice/i.test(String(b?.category || '')) ? '<p class="text-xs mt-1 text-emerald-800">Tip: bring a reusable cup or bag when you can.</p>' : ''}
      <p class="text-xs mt-2 text-slate-500">
        Report crowd:
        <a href="#" class="text-blue-600" data-crowd-report data-business-id="${escapeHtml(b?._id)}" data-level="33">Quiet</a>
        · <a href="#" class="text-blue-600" data-crowd-report data-business-id="${escapeHtml(b?._id)}" data-level="66">Busy</a>
        · <a href="#" class="text-blue-600" data-crowd-report data-business-id="${escapeHtml(b?._id)}" data-level="100">Crowded</a>
      </p>
      <div class="mt-3">
        <button
          type="button"
          class="goout-go-route px-3 py-1.5 rounded-lg ${hasLiveDeal ? 'bg-red-600 hover:bg-red-700' : 'bg-goout-green hover:bg-goout-accent'} text-white text-sm font-medium transition"
          data-go-route="1"
          data-lat="${goLat}"
          data-lng="${goLng}"
          data-kind="local"
          data-business-id="${escapeHtml(b?._id)}"
          data-label="${encodeURIComponent(mapLabel || '')}"
        >
          Go
        </button>
      </div>
    </div>
  `;
}

function poiLatLngMatch(p, hl) {
  if (!p || !hl) return false;
  return (
    Math.abs(Number(p.lat) - Number(hl.lat)) < 1e-4 &&
    Math.abs(Number(p.lng) - Number(hl.lng)) < 1e-4);

}

function poiPopupHtml(p, { isSearchPrimary } = {}) {
  const name = escapeHtml(p?.name);
  const category = escapeHtml(p?.category || 'place');
  const stars = Number.isFinite(Number(p?.rating)) ? Number(p.rating).toFixed(1) : 'N/A';
  const primaryHtml = isSearchPrimary ? '<p class="text-xs mt-1 text-purple-700 font-medium">Best match for your search</p>' : '';
  const locationText =
  Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)) ?
  `${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}` :
  'Location not available';

  return `
    <div class="min-w-[200px]">
      <h3 class="font-semibold text-slate-900">Name: ${name}</h3>
      <p class="text-xs text-slate-600 capitalize">Category: ${category}</p>
      <p class="text-xs text-slate-600">Stars: ${stars}</p>
      <p class="text-xs text-slate-600">Location: ${escapeHtml(locationText)}</p>
      ${primaryHtml}
      <div class="mt-3">
        <button
          type="button"
          class="goout-go-route px-3 py-1.5 rounded-lg bg-goout-green text-white text-sm font-medium hover:bg-goout-accent transition"
          data-go-route="1"
          data-lat="${p?.lat}"
          data-lng="${p?.lng}"
          data-kind="poi"
          data-label="${encodeURIComponent(p?.name || '')}"
        >
          Go
        </button>
      </div>
    </div>
  `;
}

function DiscoveryMap({
  userLocation,
  onLocationChange,
  enablePinSelection = false,
  userLocationAccuracy = null,
  mapCenter,
  businesses,
  offers,
  pois = [],
  categoryFilter,
  highlightedPoiLatLng = null,
  onDismissHighlightedPoi,
  isSearching = false,
  showResultsLoader = false,
  searchHasNoResults = false,
  directionsRoutes,
  selectedDirectionsRouteIndex,
  liveTrackingPoint = null,
  highlightedBusinessId,
  conciergeHighlightBusinessId = null,
  conciergePanTo = null,
  budgetCapInr = null,
  budgetPathLatLngs = null,
  compareRouteOverlays = [],
  compareVersus = null,
  mapVisualTheme = 'default',
  greenEcoRoute = null,
  destinationPoint = null,
  /** Explorer search radius (meters) — shown in footer. */
  searchRadiusM = null
}) {
  const effectiveHighlightBusinessId = highlightedBusinessId ?? conciergeHighlightBusinessId ?? null;

  const safeCenter = useMemo(() => {
    const la = Number(mapCenter?.lat);
    const lo = Number(mapCenter?.lng);
    if (Number.isFinite(la) && Number.isFinite(lo)) return { lat: la, lng: lo };
    const ula = Number(userLocation?.lat);
    const ulo = Number(userLocation?.lng);
    if (Number.isFinite(ula) && Number.isFinite(ulo)) return { lat: ula, lng: ulo };
    return { lat: 28.6139, lng: 77.2090 };
  }, [mapCenter?.lat, mapCenter?.lng, userLocation?.lat, userLocation?.lng]);

  const [isDarkMode, setIsDarkMode] = useState(
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('theme-dark')
  );

  const activeMapStyles = useMemo(() => {
    if (isDarkMode) return DARK_MAP_STYLES;
    if (mapVisualTheme === 'green') return GREEN_MAP_STYLES;
    return [];
  }, [isDarkMode, mapVisualTheme]);

  const offerIds = useMemo(
    () =>
    new Set(
      (offers || []).
      map((o) => o?.businessId?._id?.toString()).
      filter((id) => Boolean(id))
    ),
    [offers]
  );

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey || '',
    libraries: []
  });

  const mapRef = useRef(null);
  const infoWindowRef = useRef(null);
  const markersRef = useRef({
    userMarker: null,
    businessMarkers: [],
    poiMarkers: [],
    businessCluster: null,
    poiCluster: null
  });
  const polylinesRef = useRef([]);
  const compareOverlaysRef = useRef([]);
  const budgetPathRef = useRef([]);
  const greenEcoPolyRef = useRef(null);
  const greenEcoAnimTimerRef = useRef(null);
  const accuracyCircleRef = useRef(null);
  const destinationMarkerRef = useRef(null);
  const routeEndpointMarkersRef = useRef({ start: null, end: null });
  const userZoomListenerRef = useRef(null);
  const businessMarkerByIdRef = useRef(new Map());
  const highlightedIdRef = useRef(effectiveHighlightBusinessId != null ? String(effectiveHighlightBusinessId) : null);
  const businessesByIdRef = useRef(new Map());
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const update = () => {
      const active = document.documentElement.classList.contains('theme-dark');
      setIsDarkMode(active);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    highlightedIdRef.current = effectiveHighlightBusinessId != null ? String(effectiveHighlightBusinessId) : null;
    businessesByIdRef.current = new Map((businesses || []).map((b) => [String(b?._id), b]));
  }, [effectiveHighlightBusinessId, businesses]);

  const q = (categoryFilter || '').trim();
  const merchantCount = (businesses || []).length;
  const poiCount = (pois || []).length;
  const userLocationText =
  userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng) ?
  `${Number(userLocation.lat).toFixed(8)}, ${Number(userLocation.lng).toFixed(8)}${
    Number.isFinite(Number(userLocationAccuracy)) ? ` · ±${Math.round(userLocationAccuracy)} m` : ''
  }` :
  'Unavailable';

  const radiusKmLabel = (() => {
    const r = Number(searchRadiusM);
    if (Number.isFinite(r) && r >= 200) return `${Math.round(r / 100) / 10} km`;
    return '5 km';
  })();

  const footerCount = (() => {
    if (!q) {
      return `Search radius: ${radiusKmLabel} · type a query and Apply to load GoOut merchants and public places`;
    }
    if (searchHasNoResults && !isSearching) {
      return `No places found for "${q}" (within ${radiusKmLabel})`;
    }
    if (isSearching) {
      return `Searching… (${merchantCount} GoOut · ${poiCount} public within ${radiusKmLabel})`;
    }
    return `Within ${radiusKmLabel} · ${merchantCount} GoOut merchants · ${poiCount} public places (search + area)`;
  })();


  useEffect(() => {
    if (!isLoaded || loadError) return;
    if (!mapRef.current || !window.google) return;

    const google = window.google;
    const map = mapRef.current;


    const cleanup = () => {
      try {
        userZoomListenerRef.current?.remove?.();
      } catch {}
      userZoomListenerRef.current = null;
      try {
        markersRef.current.businessCluster?.clearMarkers?.();
      } catch {}
      try {
        markersRef.current.poiCluster?.clearMarkers?.();
      } catch {}
      try {
        markersRef.current.userMarker?.setMap?.(null);
      } catch {}
      try {
        accuracyCircleRef.current?.setMap?.(null);
      } catch {}

      (markersRef.current.businessMarkers || []).forEach((m) => {
        try {
          m.setMap(null);
        } catch {}
      });
      (markersRef.current.poiMarkers || []).forEach((m) => {
        try {
          m.setMap(null);
        } catch {}
      });

      markersRef.current = {
        userMarker: null,
        businessMarkers: [],
        poiMarkers: [],
        businessCluster: null,
        poiCluster: null
      };
      businessMarkerByIdRef.current = new Map();
      infoWindowRef.current?.close?.();
    };

    cleanup();

    if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();
    const infoWindow = infoWindowRef.current;


    if (
    userLocation &&
    Number.isFinite(userLocation.lat) &&
    Number.isFinite(userLocation.lng))
    {
      const acc = Number(userLocationAccuracy);
      const accLabel = Number.isFinite(acc) ? ` · ±${Math.round(acc)} m GPS` : '';
      markersRef.current.userMarker = new google.maps.Marker({
        position: { lat: userLocation.lat, lng: userLocation.lng },
        title: `Your location${accLabel}`,
        icon: buildUserLocationMarkerIcon(google, 22),
        optimized: false,
        zIndex: 9999
      });
      markersRef.current.userMarker.setMap(map);
      const radius = Number.isFinite(Number(userLocationAccuracy)) ? Math.max(8, Number(userLocationAccuracy)) : null;
      if (radius) {
        accuracyCircleRef.current = new google.maps.Circle({
          map,
          center: { lat: userLocation.lat, lng: userLocation.lng },
          radius,
          strokeColor: '#111111',
          strokeOpacity: 0.45,
          strokeWeight: 1,
          fillColor: '#111111',
          fillOpacity: 0.08,
          zIndex: 1
        });
      }

      const applyPrecisionStylingForZoom = () => {
        const zoom = Number(map.getZoom());
        const iconSize =
          zoom >= 20 ? 14 :
          zoom >= 18 ? 16 :
          zoom >= 16 ? 18 : 22;
        try {
          markersRef.current.userMarker?.setIcon?.(buildUserLocationMarkerIcon(google, iconSize));
        } catch {}
        try {
          accuracyCircleRef.current?.setOptions?.({
            strokeOpacity: zoom >= 19 ? 0.65 : 0.45,
            fillOpacity: zoom >= 19 ? 0.05 : 0.08
          });
        } catch {}
      };
      applyPrecisionStylingForZoom();
      try {
        userZoomListenerRef.current = map.addListener('zoom_changed', applyPrecisionStylingForZoom);
      } catch {}
    }

    const businessMarkers = [];
    (businesses || []).forEach((b) => {
      const loc = b?.location?.coordinates || [];
      const lng = loc?.[0];
      const lat = loc?.[1];
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;

      const isHighlighted = highlightedIdRef.current && String(b?._id) === highlightedIdRef.current;
      const isRedPin = Boolean(b?.localVerification?.redPin);
      const hasLiveDeal = offerIds.has(String(b?._id));
      const spend = estimateMerchantSpendInr(b);
      const cap = Number(budgetCapInr);
      const deal = (offers || []).find((o) => String(o?.businessId?._id || o?.businessId) === String(b?._id));
      const dealFits = Number.isFinite(cap) && cap > 0 && deal && Number(deal.offerPrice) <= cap;
      const overBudget = !isHighlighted && Number.isFinite(cap) && cap > 0 && spend > cap && !dealFits;
      const strongGreen = businessIsStrongGreen(b);
      const distanceMeters =
      userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng) ?
      (() => {
        const R = 6371e3;
        const phi1 = userLocation.lat * Math.PI / 180;
        const phi2 = Number(lat) * Math.PI / 180;
        const dPhi = (Number(lat) - userLocation.lat) * Math.PI / 180;
        const dLambda = (Number(lng) - userLocation.lng) * Math.PI / 180;
        const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      })() :
      null;

      // Local shops must always be red (single local pin color policy).
      const icon = PIN_ICONS.red;

      const marker = new google.maps.Marker({
        position: { lat: Number(lat), lng: Number(lng) },
        icon,
        zIndex: isHighlighted ? 900 : 300
      });

      marker.addListener('click', () => {
        const isHighlighted = highlightedIdRef.current && String(b?._id) === highlightedIdRef.current;

        const popupModel = { ...b, __hasLiveDeal: hasLiveDeal, distanceMeters };
        infoWindow.setContent(businessPopupHtml(popupModel, { isHighlighted }));
        infoWindow.open({ map, anchor: marker });
      });

      businessMarkerByIdRef.current.set(String(b?._id), marker);
      businessMarkers.push(marker);
    });

    const businessCluster = new MarkerClusterer({
      map,
      markers: businessMarkers,
      algorithmOptions: { maxZoom: 16 }
    });

    const poiMarkers = [];
    (pois || []).forEach((p) => {
      if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return;
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        icon: PIN_ICONS.blue
      });

      marker.addListener('click', () => {
        const isSearchPrimary = Boolean(highlightedPoiLatLng && poiLatLngMatch(p, highlightedPoiLatLng));
        infoWindow.setContent(poiPopupHtml(p, { isSearchPrimary }));
        infoWindow.open({ map, anchor: marker });
      });

      poiMarkers.push(marker);
    });

    const poiCluster = new MarkerClusterer({
      map,
      markers: poiMarkers,
      algorithmOptions: { maxZoom: 16 }
    });

    markersRef.current = {
      userMarker: markersRef.current.userMarker,
      businessMarkers,
      poiMarkers,
      businessCluster,
      poiCluster
    };
  }, [isLoaded, loadError, userLocation, userLocationAccuracy, businesses, pois, offers, offerIds, effectiveHighlightBusinessId, highlightedPoiLatLng, budgetCapInr]);


  useEffect(() => {
    if (!isLoaded || loadError || !conciergePanTo) return;
    const map = mapRef.current;
    if (!map || !window.google) return;
    const la = Number(conciergePanTo.lat);
    const lo = Number(conciergePanTo.lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    map.panTo({ lat: la, lng: lo });
    const z = map.getZoom();
    if (!Number.isFinite(z) || z < DEFAULT_ZOOM) map.setZoom(DEFAULT_ZOOM);
  }, [isLoaded, loadError, conciergePanTo]);

  const hasMountedPanRef = useRef(false);
  useEffect(() => {
    if (!isLoaded || loadError) return;
    const map = mapRef.current;
    if (!map) return;
    const la = Number(mapCenter?.lat);
    const lo = Number(mapCenter?.lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;

    // Skip first run so map does not jump unexpectedly on mount.
    if (!hasMountedPanRef.current) {
      hasMountedPanRef.current = true;
      return;
    }
    map.panTo({ lat: la, lng: lo });
  }, [isLoaded, loadError, mapCenter?.lat, mapCenter?.lng]);


  useEffect(() => {
    if (!isLoaded || loadError) return;
    if (!mapRef.current || !window.google) return;

    const google = window.google;
    const map = mapRef.current;


    (polylinesRef.current || []).forEach((p) => {
      try {
        p.setMap(null);
      } catch {}
    });
    polylinesRef.current = [];

    if (!Array.isArray(directionsRoutes) || directionsRoutes.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    const lines = [];

    directionsRoutes.forEach((r, idx) => {
      const latlngs = r?.geometryLatLng;
      if (!Array.isArray(latlngs) || latlngs.length < 2) return;

      const isSelected = idx === selectedDirectionsRouteIndex;
      const path = latlngs.
      map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) })).
      filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));

      if (path.length < 2) return;

      path.forEach((pt) => bounds.extend(pt));

      const polyline = new google.maps.Polyline({
        path,
        strokeColor: '#7c3aed',
        strokeOpacity: isSelected ? 1 : 0.25,
        strokeWeight: isSelected ? 6 : 3
      });
      polyline.setMap(map);
      lines.push(polyline);
    });

    polylinesRef.current = lines;

    if (!lines.length) return;
    if (liveTrackingPoint && Number.isFinite(liveTrackingPoint.lat) && Number.isFinite(liveTrackingPoint.lng)) {
      return;
    }
    try {
      map.fitBounds(bounds, {
        top: 30,
        bottom: 30,
        left: 30,
        right: 30,
        maxZoom: 16
      });
    } catch {

    }
  }, [isLoaded, loadError, directionsRoutes, selectedDirectionsRouteIndex, liveTrackingPoint]);

  useEffect(() => {
    if (!isLoaded || loadError || !mapRef.current || !window.google) return;
    const google = window.google;
    const map = mapRef.current;
    (budgetPathRef.current || []).forEach((p) => {
      try {
        p.setMap(null);
      } catch {}
    });
    budgetPathRef.current = [];
    if (!Array.isArray(budgetPathLatLngs) || budgetPathLatLngs.length < 2) return;
    const path = budgetPathLatLngs.
      map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })).
      filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (path.length < 2) return;
    const polyline = new google.maps.Polyline({
      path,
      strokeColor: '#475569',
      strokeOpacity: 0.9,
      strokeWeight: 3,
      geodesic: true
    });
    polyline.setMap(map);
    budgetPathRef.current = [polyline];
    return () => {
      (budgetPathRef.current || []).forEach((p) => {
        try {
          p.setMap(null);
        } catch {}
      });
      budgetPathRef.current = [];
    };
  }, [isLoaded, loadError, budgetPathLatLngs]);

  useEffect(() => {
    if (!isLoaded || loadError || !mapRef.current || !window.google) return;
    const google = window.google;
    const map = mapRef.current;
    (compareOverlaysRef.current || []).forEach((p) => {
      try {
        p.setMap(null);
      } catch {}
    });
    compareOverlaysRef.current = [];
    if (!Array.isArray(compareRouteOverlays) || compareRouteOverlays.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    const lines = [];

    compareRouteOverlays.forEach((layer) => {
      const latlngs = layer?.geometryLatLng;
      if (!Array.isArray(latlngs) || latlngs.length < 2) return;
      const path = latlngs.
      map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) })).
      filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
      if (path.length < 2) return;
      path.forEach((pt) => bounds.extend(pt));
      const polyline = new google.maps.Polyline({
        path,
        strokeColor: layer.strokeColor || '#94a3b8',
        strokeOpacity: typeof layer.strokeOpacity === 'number' ? layer.strokeOpacity : 0.92,
        strokeWeight: layer.strokeWeight || 4,
        zIndex: typeof layer.zIndex === 'number' ? layer.zIndex : 1,
        geodesic: true
      });
      polyline.setMap(map);
      lines.push(polyline);
    });

    compareOverlaysRef.current = lines;
    if (!lines.length) return;
    try {
      map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50, maxZoom: 15 });
    } catch {}
    return () => {
      (compareOverlaysRef.current || []).forEach((p) => {
        try {
          p.setMap(null);
        } catch {}
      });
      compareOverlaysRef.current = [];
    };
  }, [isLoaded, loadError, compareRouteOverlays]);

  useEffect(() => {
    if (!isLoaded || loadError || !mapRef.current || !window.google) return;
    const map = mapRef.current;
    try {
      map.setOptions({ styles: activeMapStyles });
    } catch {}
  }, [isLoaded, loadError, activeMapStyles]);

  useEffect(() => {
    if (!isLoaded || loadError || !mapRef.current || !window.google) return;
    const google = window.google;
    const map = mapRef.current;
    if (greenEcoAnimTimerRef.current) {
      clearInterval(greenEcoAnimTimerRef.current);
      greenEcoAnimTimerRef.current = null;
    }
    try {
      greenEcoPolyRef.current?.setMap?.(null);
    } catch {}
    greenEcoPolyRef.current = null;

    const latlngs = greenEcoRoute?.geometryLatLng;
    if (!Array.isArray(latlngs) || latlngs.length < 2) return;

    const path = latlngs.
    map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) })).
    filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
    if (path.length < 2) return;

    const lineSymbol = {
      path: google.maps.SymbolPath.CIRCLE,
      fillOpacity: 1,
      scale: 3.5,
      strokeColor: '#ffffff',
      strokeWeight: 1,
      fillColor: '#10b981'
    };

    const polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: '#059669',
      strokeOpacity: 0.88,
      strokeWeight: 6,
      zIndex: 4,
      icons: [{ icon: lineSymbol, offset: '0%', repeat: '18px' }]
    });
    polyline.setMap(map);
    greenEcoPolyRef.current = polyline;

    let step = 0;
    greenEcoAnimTimerRef.current = setInterval(() => {
      step = (step + 2) % 100;
      try {
        polyline.set('icons', [{ icon: lineSymbol, offset: `${step}%`, repeat: '18px' }]);
      } catch {}
    }, 90);

    const bounds = new google.maps.LatLngBounds();
    path.forEach((pt) => bounds.extend(pt));
    try {
      map.fitBounds(bounds, { top: 48, bottom: 48, left: 48, right: 48, maxZoom: 15 });
    } catch {}

    return () => {
      if (greenEcoAnimTimerRef.current) {
        clearInterval(greenEcoAnimTimerRef.current);
        greenEcoAnimTimerRef.current = null;
      }
      try {
        polyline.setMap(null);
      } catch {}
    };
  }, [isLoaded, loadError, greenEcoRoute]);

  useEffect(() => {
    if (!isLoaded || loadError || !mapRef.current || !window.google) return;
    const map = mapRef.current;
    try {
      destinationMarkerRef.current?.setMap?.(null);
    } catch {}
    destinationMarkerRef.current = null;
    // Destination marker intentionally disabled:
    // destination is represented by the selected place pin + route endpoint.
    return () => {
      try {
        destinationMarkerRef.current?.setMap?.(null);
      } catch {}
      destinationMarkerRef.current = null;
    };
  }, [isLoaded, loadError, destinationPoint]);

  useEffect(() => {
    if (!isLoaded || loadError || !mapRef.current || !window.google) return;
    const google = window.google;
    const map = mapRef.current;
    const clearEndpoints = () => {
      try {
        routeEndpointMarkersRef.current.start?.setMap?.(null);
      } catch {}
      try {
        routeEndpointMarkersRef.current.end?.setMap?.(null);
      } catch {}
      routeEndpointMarkersRef.current = { start: null, end: null };
    };

    clearEndpoints();
    if (!Array.isArray(directionsRoutes) || directionsRoutes.length === 0) return;

    const startLat = Number(liveTrackingPoint?.lat ?? userLocation?.lat);
    const startLng = Number(liveTrackingPoint?.lng ?? userLocation?.lng);
    const endLat = Number(destinationPoint?.lat);
    const endLng = Number(destinationPoint?.lng);
    if (!Number.isFinite(startLat) || !Number.isFinite(startLng) || !Number.isFinite(endLat) || !Number.isFinite(endLng)) {
      return;
    }

    const startMarker = new google.maps.Marker({
      map,
      position: { lat: startLat, lng: startLng },
      title: 'Route start',
      icon: buildUserLocationMarkerIcon(google, 18),
      optimized: false,
      zIndex: 9800
    });
    const endMarker = new google.maps.Marker({
      map,
      position: { lat: endLat, lng: endLng },
      title: destinationPoint?.label ? `Destination: ${destinationPoint.label}` : 'Route destination',
      icon: destinationPoint?.kind === 'local' ? PIN_ICONS.red : PIN_ICONS.blue,
      optimized: false,
      zIndex: 9700
    });
    routeEndpointMarkersRef.current = { start: startMarker, end: endMarker };
    return clearEndpoints;
  }, [
    isLoaded,
    loadError,
    directionsRoutes,
    userLocation?.lat,
    userLocation?.lng,
    liveTrackingPoint?.lat,
    liveTrackingPoint?.lng,
    destinationPoint?.lat,
    destinationPoint?.lng,
    destinationPoint?.kind,
    destinationPoint?.label
  ]);

  if (!apiKey) {
    return (
      <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm p-4 text-sm text-slate-700">
        Google Maps API key is missing. Set `VITE_GOOGLE_MAPS_API_KEY` in `client/.env`.
      </div>);

  }

  if (loadError) {
    return (
      <div className="rounded-2xl overflow-hidden border border-red-200 bg-white shadow-sm p-4 text-sm text-red-700">
        Failed to load Google Maps: {String(loadError.message || loadError)}
      </div>);

  }

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
      <div className="h-[500px] relative">
        {highlightedPoiLatLng && typeof onDismissHighlightedPoi === 'function' &&
        <button
          type="button"
          className="absolute top-3 left-3 z-[6] flex h-11 w-11 items-center justify-center rounded-full border-2 border-slate-200/90 bg-white/95 text-slate-500 shadow-lg backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
          onClick={(e) => {
            e.stopPropagation();
            onDismissHighlightedPoi();
          }}
          aria-label="Hide this search result from the map"
          title="Hide from map">
          
            <span className="text-2xl font-light leading-none select-none" aria-hidden>
              ×
            </span>
          </button>
        }
        {greenEcoRoute && Number.isFinite(Number(greenEcoRoute.co2SavedGrams)) &&
        <div className="absolute bottom-3 left-3 z-[5] max-w-[min(92vw,260px)] rounded-xl bg-emerald-950/90 text-emerald-50 border border-emerald-600/50 shadow-lg px-3 py-2 text-xs pointer-events-none">
            <p className="font-semibold flex items-center gap-1.5">
              <span aria-hidden>☁</span>
              ~{Math.round(Number(greenEcoRoute.co2SavedGrams))} g CO₂ vs car
            </p>
            {greenEcoRoute.modeLabel &&
          <p className="text-emerald-200/90 mt-0.5 capitalize">{greenEcoRoute.modeLabel} route · Green preview</p>
          }
          </div>
        }
        {compareVersus && Array.isArray(compareVersus.options) && compareVersus.options.length >= 2 &&
        <div className="absolute top-3 right-3 z-[5] max-w-[min(92vw,300px)] rounded-xl bg-white/95 border border-slate-200 shadow-lg p-3 text-xs pointer-events-none">
            <p className="font-semibold text-slate-900 mb-2">Comparator · Versus</p>
            <div className="space-y-2">
              {compareVersus.options.map((o) =>
            <div
              key={o.businessId}
              className={`rounded-lg px-2 py-1.5 border ${
              String(o.businessId) === String(compareVersus.topPickId) ?
              'border-emerald-300 bg-emerald-50' :
              'border-slate-200 bg-slate-50'}`
              }>
              
                  <p className="font-medium text-slate-800 truncate">{o.name}</p>
                  <p className="text-slate-600 mt-0.5">
                    Value {o.valueScore} · Benefit {o.benefitScore} · Cost score ₹{o.totalCostScore}
                  </p>
                  {String(o.businessId) === String(compareVersus.topPickId) &&
              <p className="text-emerald-800 font-medium mt-1">Top pick</p>
              }
                </div>
            )}
            </div>
          </div>
        }
        {!isLoaded ?
        <div className="h-full w-full flex items-center justify-center text-sm text-slate-600">
            Loading Google Maps...
          </div> :

        <GoogleMap
          onLoad={(map) => {
            mapRef.current = map;
            try {
              map.setTilt(0);
            } catch {}
          }}
          onClick={(e) => {
            if (!enablePinSelection || typeof onLocationChange !== 'function') return;
            const ll = e?.latLng;
            if (!ll) return;
            onLocationChange(ll.lat(), ll.lng());
          }}
          center={safeCenter}
          zoom={DEFAULT_ZOOM}
          mapContainerStyle={{ width: '100%', height: '100%' }}
          options={{
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            styles: activeMapStyles,
            tilt: 0,
            heading: 0
          }} />

        }
        {(isSearching || showResultsLoader) && (
          <div className="absolute inset-0 z-[7] pointer-events-none bg-white/45 backdrop-blur-[1px] flex items-center justify-center">
            <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow">
              Loading places...
            </div>
          </div>
        )}
        {enablePinSelection &&
        <div className="absolute top-3 left-3 z-[6] rounded-lg bg-emerald-50/95 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 shadow-sm">
            Pin mode ON: click map to set exact location.
          </div>
        }
      </div>
      <div className="p-4 bg-slate-50 border-t flex flex-col gap-1 text-sm">
        <span><strong>Your location:</strong> {userLocationText}</span>
        <span><strong>Public places found by search:</strong> {q ? poiCount : 0}</span>
        <span><strong>Local places found by search:</strong> {q ? merchantCount : 0}</span>
        {Number.isFinite(Number(budgetCapInr)) && Number(budgetCapInr) > 0 &&
        <span className="text-xs text-slate-600">
            Budget overlay: grey pins are above your cap (or use a flash deal if one appears). Larger green dots highlight strong sustainability tags.
          </span>
        }
        {Array.isArray(compareRouteOverlays) && compareRouteOverlays.length > 0 &&
        <span className="text-xs text-slate-600">
            Comparator routes: green = best value for your goals; grey = alternate choice.
          </span>
        }
        {mapVisualTheme === 'green' &&
        <span className="text-xs text-emerald-800">
            Green layer: parks and landscape are emphasized; animated line = eco route preview from Green tab.
          </span>
        }
      </div>
    </div>);

}

export default DiscoveryMap;