import { useEffect, useMemo, useRef } from 'react';
import { GoogleMap, useLoadScript } from '@react-google-maps/api';
import { MarkerClusterer } from '@googlemaps/markerclusterer';

const DEFAULT_ZOOM = 15;
const PIN_ICONS = {
  red: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
  green: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
  blue: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
  yellow: 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png',
  purple: 'https://maps.google.com/mapfiles/ms/icons/purple-dot.png',
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
  if (n < 33) return '🟢 Quiet';
  if (n < 66) return '🟡 Busy';
  return '🔴 Crowded';
}

function businessPopupHtml(b, { isHighlighted }) {
  const name = escapeHtml(b?.name);
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

  const recommendedHtml = isHighlighted ? '<p class="text-xs mt-1 text-purple-700 font-medium">Recommended by AI</p>' : '';
  const verifiedHtml = isRedPin ? '<p class="text-xs mt-1 text-red-700 font-medium">🔴 Verified Local (Red Pin)</p>' : '';

  const goLat = Number.isFinite(lat) ? lat : '';
  const goLng = Number.isFinite(lng) ? lng : '';

  return `
    <div class="min-w-[200px]">
      <h3 class="font-semibold text-slate-900">${name}</h3>
      <p class="text-sm text-slate-600">${category}</p>
      <p class="text-sm">₹${avgPrice} avg · ⭐ ${rating.toFixed(1) || '—'}</p>
      ${verifiedHtml}
      ${recommendedHtml}
      ${crowdHtml}
      <p class="text-xs mt-2 text-slate-500">
        Actually:
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
          data-label="${encodeURIComponent(b?.name || '')}"
        >
          Go
        </button>
      </div>
    </div>
  `;
}

function poiPopupHtml(p) {
  const name = escapeHtml(p?.name);
  const category = escapeHtml(p?.category || 'place');
  const distanceText =
    typeof p?.distanceMeters === 'number' ? `${(p.distanceMeters / 1000).toFixed(2)} km away` : '';

  return `
    <div class="min-w-[200px]">
      <h3 class="font-semibold text-slate-900">${name}</h3>
      <p class="text-xs text-slate-600 capitalize">${category}</p>
      ${distanceText ? `<p class="text-xs text-slate-500 mt-1">${escapeHtml(distanceText)}</p>` : ''}
      <div class="mt-3">
        <button
          type="button"
          class="goout-go-route px-3 py-1.5 rounded-lg bg-goout-green text-white text-sm font-medium hover:bg-goout-accent transition"
          data-go-route="1"
          data-lat="${p?.lat}"
          data-lng="${p?.lng}"
          data-label="${encodeURIComponent(p?.name || '')}"
        >
          Go
        </button>
      </div>
    </div>
  `;
}

export default function DiscoveryMap({
  userLocation,
  mapCenter,
  businesses,
  offers,
  pois = [],
  categoryFilter,
  directionsRoutes,
  selectedDirectionsRouteIndex,
  highlightedBusinessId,
}) {
  const center = mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : { lat: userLocation.lat, lng: userLocation.lng };

  const offerIds = useMemo(
    () =>
      new Set(
        (offers || [])
          .map((o) => o?.businessId?._id?.toString())
          .filter((id) => Boolean(id))
      ),
    [offers]
  );

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey || '',
    libraries: [],
  });

  const mapRef = useRef(null);
  const infoWindowRef = useRef(null);
  const markersRef = useRef({
    userMarker: null,
    businessMarkers: [],
    poiMarkers: [],
    businessCluster: null,
    poiCluster: null,
  });
  const polylinesRef = useRef([]);
  const businessMarkerByIdRef = useRef(new Map());
  const highlightedIdRef = useRef(highlightedBusinessId != null ? String(highlightedBusinessId) : null);
  const businessesByIdRef = useRef(new Map());

  useEffect(() => {
    highlightedIdRef.current = highlightedBusinessId != null ? String(highlightedBusinessId) : null;
    businessesByIdRef.current = new Map((businesses || []).map((b) => [String(b?._id), b]));
  }, [highlightedBusinessId, businesses]);

  const footerCount =
    categoryFilter
      ? `${(businesses || []).length} ${categoryFilter} from GoOut merchants · ${pois.length} public places`
      : `${(businesses || []).length} places within 5km (nearest to you)`;

  // Render markers + clustering
  useEffect(() => {
    if (!isLoaded || loadError) return;
    if (!mapRef.current || !window.google) return;

    const google = window.google;
    const map = mapRef.current;

    // Cleanup previous markers/clusters.
    const cleanup = () => {
      try {
        markersRef.current.businessCluster?.clearMarkers?.();
      } catch {}
      try {
        markersRef.current.poiCluster?.clearMarkers?.();
      } catch {}
      try {
        markersRef.current.userMarker?.setMap?.(null);
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
        poiCluster: null,
      };
      businessMarkerByIdRef.current = new Map();
      infoWindowRef.current?.close?.();
    };

    cleanup();

    if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();
    const infoWindow = infoWindowRef.current;

    // User marker
    if (
      userLocation &&
      Number.isFinite(userLocation.lat) &&
      Number.isFinite(userLocation.lng)
    ) {
      markersRef.current.userMarker = new google.maps.Marker({
        position: { lat: userLocation.lat, lng: userLocation.lng },
        title: 'You are here',
        icon: PIN_ICONS.blue,
      });
      markersRef.current.userMarker.setMap(map);
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
      // Priority: AI highlight > live deal > verified red > regular business.
      let icon = PIN_ICONS.green;
      if (isRedPin) icon = PIN_ICONS.red;
      if (hasLiveDeal) icon = PIN_ICONS.yellow;
      if (isHighlighted) icon = PIN_ICONS.purple;

      const marker = new google.maps.Marker({
        position: { lat: Number(lat), lng: Number(lng) },
        icon,
      });

      marker.addListener('click', () => {
        const isHighlighted = highlightedIdRef.current && String(b?._id) === highlightedIdRef.current;
        // Inject deal info to reuse popup builder without threading extra state everywhere.
        const popupModel = { ...b, __hasLiveDeal: hasLiveDeal };
        infoWindow.setContent(businessPopupHtml(popupModel, { isHighlighted }));
        infoWindow.open({ map, anchor: marker });
      });

      businessMarkerByIdRef.current.set(String(b?._id), marker);
      businessMarkers.push(marker);
    });

    const businessCluster = new MarkerClusterer({
      map,
      markers: businessMarkers,
      algorithmOptions: { maxZoom: 16 },
    });

    const poiMarkers = [];
    (pois || []).forEach((p) => {
      if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return;
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        icon: PIN_ICONS.blue,
      });

      marker.addListener('click', () => {
        infoWindow.setContent(poiPopupHtml(p));
        infoWindow.open({ map, anchor: marker });
      });

      poiMarkers.push(marker);
    });

    const poiCluster = new MarkerClusterer({
      map,
      markers: poiMarkers,
      algorithmOptions: { maxZoom: 16 },
    });

    markersRef.current = {
      userMarker: markersRef.current.userMarker,
      businessMarkers,
      poiMarkers,
      businessCluster,
      poiCluster,
    };
  }, [isLoaded, loadError, userLocation, businesses, pois, offerIds, highlightedBusinessId]);

  // Open InfoWindow for the AI-highlighted business
  useEffect(() => {
    if (!isLoaded || loadError) return;
    const highlightedId = highlightedBusinessId != null ? String(highlightedBusinessId) : null;
    if (!highlightedId) return;
    const map = mapRef.current;
    const infoWindow = infoWindowRef.current;
    if (!map || !infoWindow) return;

    const marker = businessMarkerByIdRef.current.get(highlightedId);
    const b = businessesByIdRef.current.get(highlightedId);
    if (!marker || !b) return;

    const hasLiveDeal = offerIds.has(String(b?._id));
    const popupModel = { ...b, __hasLiveDeal: hasLiveDeal };
    infoWindow.setContent(businessPopupHtml(popupModel, { isHighlighted: true }));
    infoWindow.open({ map, anchor: marker });
  }, [isLoaded, loadError, highlightedBusinessId, offerIds]);

  // Render direction polylines
  useEffect(() => {
    if (!isLoaded || loadError) return;
    if (!mapRef.current || !window.google) return;

    const google = window.google;
    const map = mapRef.current;

    // Cleanup old polylines.
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
      const path = latlngs
        .map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) }))
        .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));

      if (path.length < 2) return;

      path.forEach((pt) => bounds.extend(pt));

      const polyline = new google.maps.Polyline({
        path,
        strokeColor: '#7c3aed',
        strokeOpacity: isSelected ? 1 : 0.25,
        strokeWeight: isSelected ? 6 : 3,
      });
      polyline.setMap(map);
      lines.push(polyline);
    });

    polylinesRef.current = lines;

    if (!lines.length) return;
    try {
      map.fitBounds(bounds, {
        top: 30,
        bottom: 30,
        left: 30,
        right: 30,
        maxZoom: 16,
      });
    } catch {
      // ignore
    }
  }, [isLoaded, loadError, directionsRoutes, selectedDirectionsRouteIndex]);

  if (!apiKey) {
    return (
      <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm p-4 text-sm text-slate-700">
        Google Maps API key is missing. Set `VITE_GOOGLE_MAPS_API_KEY` in `client/.env`.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl overflow-hidden border border-red-200 bg-white shadow-sm p-4 text-sm text-red-700">
        Failed to load Google Maps: {String(loadError.message || loadError)}
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
      <div className="h-[500px] relative">
        {!isLoaded ? (
          <div className="h-full w-full flex items-center justify-center text-sm text-slate-600">
            Loading Google Maps...
          </div>
        ) : (
          <GoogleMap
            onLoad={(map) => {
              mapRef.current = map;
            }}
            center={center}
            zoom={DEFAULT_ZOOM}
            mapContainerStyle={{ width: '100%', height: '100%' }}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              clickableIcons: false,
            }}
          />
        )}
      </div>
      <div className="p-4 bg-slate-50 border-t flex flex-wrap gap-4 items-center text-sm">
        <span>🔵 Your location & public places</span>
        <span>🟢 GoOut merchants</span>
        <span>🔴 Verified local-first merchants</span>
        <span>🟡 Live Flash Deal</span>
        <span>🟣 AI recommended place</span>
        <span>{footerCount}</span>
      </div>
    </div>
  );
}
