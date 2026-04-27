import { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useLoadScript } from '@react-google-maps/api';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { estimateMerchantSpendInr, businessIsStrongGreen, poiMatchesPreciseQuery } from '../../utils/searchMapRank';
import api, { getAssetUrl } from '../../api/client';

const GOOGLE_MAPS_LIBRARIES = ['places'];

const DEFAULT_ZOOM = 17;
const PIN_COLORS = Object.freeze({
  LOCAL_RED: '#ef4444',
  LOCAL_RED_DEAL: '#dc2626',
  EXACT_BLUE: '#2563eb',
  MAYBE_GREY: '#6b7280'
});

/** Rich green map style for modern themed experience. */
const GREEN_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#163a2c' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#c9e6d7' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f2a20' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#dcfce7' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#133527' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1a4633' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1f573d' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#b8f2c9' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2b5d46' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#224d3a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#d8f5e2' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#367559' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#275741' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#204d39' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b271e' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#99d9bf' }] }
];

const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#10281f' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#091710' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9ec8b3' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d1fae5' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#17392b' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#9ec8b3' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#244c39' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#193626' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2f664d' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#214936' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1a3d2d' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a1d16' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#82b39d' }] }
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

function buildMapPinIcon(google, { fill = '#ef4444', stroke = '#ffffff', dot = '#ffffff', size = 34, pulse = false } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
    <defs>
      <filter id="gooutPinShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="1.4" stdDeviation="1.2" flood-color="#0f172a" flood-opacity="0.28"/>
      </filter>
      <linearGradient id="gooutPinGloss" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${pulse ? `<circle cx="14" cy="12.2" r="4.4" fill="none" stroke="${fill}" stroke-opacity="0.62" stroke-width="1.4">
      <animate attributeName="r" values="4.4;9.6;4.4" dur="1.8s" repeatCount="indefinite" />
      <animate attributeName="stroke-opacity" values="0.62;0;0.62" dur="1.8s" repeatCount="indefinite" />
    </circle>` : ''}
    <g filter="url(#gooutPinShadow)">
      <path d="M14 26s-8-5.1-8-13a8 8 0 1 1 16 0c0 7.9-8 13-8 13z" fill="${fill}" stroke="${stroke}" stroke-width="1.35"/>
      <path d="M14 6.1a6.2 6.2 0 0 1 6.2 6.2c0 5.2-4.5 9.2-6.2 10.5-1.7-1.3-6.2-5.3-6.2-10.5A6.2 6.2 0 0 1 14 6.1z" fill="url(#gooutPinGloss)"/>
      <circle cx="14" cy="12.2" r="3.3" fill="${dot}" stroke="#ffffff" stroke-opacity="0.85" stroke-width="0.55"/>
      <circle cx="14" cy="12.2" r="1.3" fill="#ffffff" fill-opacity="0.75"/>
    </g>
  </svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  const anchor = Math.round(size / 2);
  return {
    url,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(anchor, size - 3)
  };
}

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

function crowdFreshnessText(lastPing) {
  const ts = new Date(lastPing || '').getTime();
  if (!Number.isFinite(ts)) return 'Live updates';
  const deltaMs = Date.now() - ts;
  if (deltaMs < 60 * 1000) return 'Updated just now';
  if (deltaMs < 60 * 60 * 1000) return `Updated ${Math.max(1, Math.round(deltaMs / 60000))}m ago`;
  return `Updated ${Math.max(1, Math.round(deltaMs / 3600000))}h ago`;
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
  const crowdNum = Math.max(0, Math.min(100, Number(b?.crowdLevel) || 0));
  const crowdHtml = crowd ?
    `<div class="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
      <div class="flex items-center justify-between gap-2">
        <p class="text-[11px] font-semibold text-slate-700">Live crowd</p>
        <span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">LIVE</span>
      </div>
      <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div class="h-full rounded-full ${crowdNum >= 66 ? 'bg-rose-500' : crowdNum >= 33 ? 'bg-amber-500' : 'bg-emerald-500'}" style="width:${crowdNum}%"></div>
      </div>
      <p class="mt-1 text-[11px] text-slate-700">${escapeHtml(crowd)} · ${crowdNum}%</p>
      <p class="mt-0.5 text-[10px] text-slate-500">${escapeHtml(crowdFreshnessText(b?.crowdLastPing))}</p>
      <p class="text-[11px] mt-1.5 text-slate-600">
        Report:
        <a href="#" class="text-blue-600 font-medium" data-crowd-report data-business-id="${escapeHtml(b?._id)}" data-level="33">Quiet</a>
        · <a href="#" class="text-blue-600 font-medium" data-crowd-report data-business-id="${escapeHtml(b?._id)}" data-level="66">Busy</a>
        · <a href="#" class="text-blue-600 font-medium" data-crowd-report data-business-id="${escapeHtml(b?._id)}" data-level="100">Crowded</a>
      </p>
    </div>` :
    '';
  const address = escapeHtml(b?.address || '');
  const vibe = escapeHtml(b?.vibe || '');
  const ecoFlags = [];
  if (b?.ecoOptions?.plasticFree) ecoFlags.push('Plastic-free');
  if (b?.ecoOptions?.solarPowered) ecoFlags.push('Solar powered');
  if (b?.ecoOptions?.zeroWaste) ecoFlags.push('Zero-waste');
  if (b?.carbonWalkIncentive) ecoFlags.push('Walker incentive');
  const ecoHtml = ecoFlags.length ? `<p class="text-xs mt-1 text-emerald-800">Eco: ${ecoFlags.map((x) => escapeHtml(x)).join(' · ')}</p>` : '';
  const descriptionText = escapeHtml(String(b?.description || b?.localSourcingNote || '').trim());
  const descriptionHtml = descriptionText ? `<p class="text-xs mt-1.5 text-slate-700"><span class="font-semibold text-slate-800">Description:</span> ${descriptionText}</p>` : '';
  const distanceText =
  typeof b?.distanceMeters === 'number' && Number.isFinite(b.distanceMeters) ?
  `<p class="text-xs mt-1 text-slate-500">Distance: ${b.distanceMeters < 1000 ? `${Math.round(b.distanceMeters)} m` : `${(b.distanceMeters / 1000).toFixed(2)} km`}</p>` :
  '';

  const recommendedHtml = isHighlighted ? '<p class="text-xs mt-1 text-purple-700 font-medium">Highlighted match</p>' : '';
  const verifiedHtml = isRedPin ? '<p class="text-xs mt-1 text-red-700 font-medium">🔴 Verified Local (Red Pin)</p>' : '';

  const goLat = Number.isFinite(lat) ? lat : '';
  const goLng = Number.isFinite(lng) ? lng : '';

  const menuPath = String(b?.menuCatalogFileUrl || '').trim();
  const menuAbs = getAssetUrl(menuPath);
  const menuLinkHtml = menuAbs
    ? `<p class="mt-2"><a href="${escapeHtml(menuAbs)}" target="_blank" rel="noopener noreferrer" class="text-emerald-700 font-semibold underline hover:text-emerald-900">View menu</a></p>`
    : '';
  const menuAnchorHtml = menuAbs
    ? `<a href="${escapeHtml(menuAbs)}" target="_blank" rel="noopener noreferrer" class="text-emerald-700 font-semibold underline hover:text-emerald-900">View menu</a>`
    : '';

  return `
    <div class="goout-map-popup min-w-[250px] max-w-[330px] rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h3 class="font-semibold text-slate-900 text-sm leading-snug">${name}</h3>
          <p class="text-xs text-slate-600 mt-0.5">${category || 'N/A'}</p>
        </div>
        ${hasLiveDeal ? '<span class="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">Flash deal</span>' : ''}
      </div>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <div class="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5">
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Rating</p>
          <p class="text-xs font-semibold text-slate-800">⭐ ${rating.toFixed(1) || '—'}</p>
        </div>
        <div class="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5">
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Distance</p>
          <p class="text-xs font-semibold text-slate-800">${distanceText ? distanceText.replace(/<[^>]*>/g, '').replace('Distance: ', '') : 'N/A'}</p>
        </div>
      </div>
      <p class="text-[11px] mt-2 text-slate-600">${address || 'Location not available'}</p>
      ${menuAnchorHtml ? `<p class="mt-2 text-xs font-medium text-emerald-800">Menu: ${menuAnchorHtml}</p>` : '<p class="mt-2 text-xs text-slate-500">Menu: Not available</p>'}
      ${vibe ? `<p class="text-xs mt-1 text-slate-700">Vibe: ${vibe}</p>` : ''}
      ${descriptionHtml}
      ${verifiedHtml}
      ${recommendedHtml}
      ${crowdHtml}
      ${ecoHtml}
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

function poiPopupHtml(p, { isSearchPrimary, isExactSearchMatch, isMayMatch } = {}) {
  const name = escapeHtml(p?.name);
  const category = escapeHtml(p?.category || 'place');
  const stars = Number.isFinite(Number(p?.rating)) ? Number(p.rating).toFixed(1) : 'N/A';
  const statusHtml = isSearchPrimary ?
    '<p class="text-xs mt-1 text-purple-700 font-medium">Best match for your search</p>' :
    isExactSearchMatch ?
      '<p class="text-xs mt-1 text-blue-900 font-medium">Exact match</p>' :
      isMayMatch ?
        '<p class="text-xs mt-1 text-blue-700 font-medium">May match your search</p>' :
        '';
  const locationText =
  Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)) ?
  `${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}` :
  'Location not available';

  return `
    <div class="goout-map-popup min-w-[200px]">
      <h3 class="font-semibold text-slate-900">Name: ${name}</h3>
      <p class="text-xs text-slate-600 capitalize">Category: ${category}</p>
      <p class="text-xs text-slate-600">Stars: ${stars}</p>
      <p class="text-xs text-slate-600">Location: ${escapeHtml(locationText)}</p>
      ${statusHtml}
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

function summarizeReviewText(text, maxLen = 180) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen).trim()}…`;
}

function toAssetUrl(pathLike) {
  return getAssetUrl(pathLike);
}

function poiGoogleLikePopupHtml(p, details, { isSearchPrimary, isExactSearchMatch, isMayMatch } = {}) {
  const name = escapeHtml(details?.name || p?.name || 'Place');
  const category = escapeHtml(p?.category || details?.types?.[0] || 'place');
  const ratingNum = Number(details?.rating ?? p?.rating);
  const stars = Number.isFinite(ratingNum) ? ratingNum.toFixed(1) : 'N/A';
  const ratingsCount = Number(details?.userRatingsTotal || details?.user_ratings_total || 0);
  const openNow = details?.openingHours?.openNow;
  const openBadge =
    openNow === true ? '<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">Open now</span>' :
      openNow === false ? '<span class="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">Closed now</span>' :
        '';
  const locationText = escapeHtml(
    details?.formattedAddress || details?.vicinity || (
      Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)) ?
        `${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}` :
        'Location not available'
    )
  );
  const website = String(details?.website || details?.websiteUrl || '').trim();
  const mapsUrl = Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)) ?
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lng}`)}` :
    '';
  const priceLevel = Number(details?.priceLevel ?? details?.price_level);
  const priceText = Number.isFinite(priceLevel) && priceLevel >= 0 && priceLevel <= 4 ? '₹'.repeat(Math.max(1, priceLevel + 1)) : '';
  const reviewRows = Array.isArray(details?.reviews) ? details.reviews.slice(0, 2) : [];
  const reviewsHtml = reviewRows.length ?
    `<div class="mt-2 space-y-1.5">${reviewRows.map((r) => {
      const rr = Number(r?.rating);
      const rStars = Number.isFinite(rr) ? `⭐ ${rr.toFixed(1)}` : '';
      const author = escapeHtml(r?.author_name || r?.authorAttribution?.displayName || 'Visitor');
      const txt = escapeHtml(summarizeReviewText(r?.text || r?.originalText || ''));
      return `<div class="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5"><p class="text-[11px] font-medium text-slate-700">${author}${rStars ? ` · ${rStars}` : ''}</p><p class="text-[11px] text-slate-600 mt-0.5">${txt}</p></div>`;
    }).join('')}</div>` :
    '<p class="text-xs text-slate-500 mt-2">No review snippets available.</p>';
  const photoUrl = String(details?.photoUrl || '').trim();
  const statusHtml = isSearchPrimary ?
    '<p class="text-xs mt-1 text-purple-700 font-medium">Best match for your search</p>' :
    isExactSearchMatch ?
      '<p class="text-xs mt-1 text-blue-900 font-medium">Exact match</p>' :
      isMayMatch ?
        '<p class="text-xs mt-1 text-blue-700 font-medium">May match your search</p>' :
        '';

  return `
    <div class="goout-map-popup min-w-[240px] max-w-[320px]">
      <h3 class="font-semibold text-slate-900 text-sm">${name}</h3>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <p class="text-xs text-slate-600 capitalize">${category}</p>
        ${openBadge}
      </div>
      <p class="text-xs text-slate-600 mt-1">⭐ ${stars}${ratingsCount > 0 ? ` (${ratingsCount.toLocaleString()} reviews)` : ''}${priceText ? ` · ${priceText}` : ''}</p>
      <p class="text-xs text-slate-600 mt-1">${locationText}</p>
      ${statusHtml}
      ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="${name}" class="mt-2 h-28 w-full rounded-lg object-cover border border-slate-200" />` : ''}
      <div class="mt-2">
        <p class="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Recent reviews</p>
        ${reviewsHtml}
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
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
        ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50">Website</a>` : ''}
        ${mapsUrl ? `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50">Open in Maps</a>` : ''}
      </div>
    </div>
  `;
}

function placeSearchPromise(service, request) {
  return new Promise((resolve) => {
    try {
      service.nearbySearch(request, (results, status) => {
        resolve({ results: Array.isArray(results) ? results : [], status });
      });
    } catch {
      resolve({ results: [], status: 'ERROR' });
    }
  });
}

function placeDetailsPromise(service, request) {
  return new Promise((resolve) => {
    try {
      service.getDetails(request, (result, status) => {
        resolve({ result: result || null, status });
      });
    } catch {
      resolve({ result: null, status: 'ERROR' });
    }
  });
}

function placeFindFromQueryPromise(service, request) {
  return new Promise((resolve) => {
    try {
      service.findPlaceFromQuery(request, (results, status) => {
        resolve({ results: Array.isArray(results) ? results : [], status });
      });
    } catch {
      resolve({ results: [], status: 'ERROR' });
    }
  });
}

function normalizeGooglePlaceId(rawId) {
  const s = String(rawId || '').trim();
  if (!s) return '';
  // New Places API can return IDs as "places/PLACE_ID".
  if (s.startsWith('places/')) return s.split('/').pop() || '';
  return s;
}

function mapDetailsResult(result) {
  if (!result) return null;
  const photoUrls =
    Array.isArray(result.photos) && result.photos.length > 0 ?
      result.photos.slice(0, 8).map((ph) => ph.getUrl({ maxWidth: 1200, maxHeight: 900 })).filter(Boolean) :
      [];
  const photoUrl =
    Array.isArray(result.photos) && result.photos.length > 0 ?
      result.photos[0].getUrl({ maxWidth: 640, maxHeight: 360 }) :
      '';
  return {
    name: result.name,
    formattedAddress: result.formatted_address,
    vicinity: result.vicinity,
    rating: result.rating,
    userRatingsTotal: result.user_ratings_total,
    reviews: Array.isArray(result.reviews) ? result.reviews : [],
    openingHours: {
      openNow: result.opening_hours?.isOpen?.() ?? result.opening_hours?.open_now,
      weekdayText: Array.isArray(result.opening_hours?.weekday_text) ? result.opening_hours.weekday_text : []
    },
    website: result.website,
    googleMapsUrl: result.url,
    formattedPhoneNumber: result.formatted_phone_number,
    internationalPhoneNumber: result.international_phone_number,
    businessStatus: result.business_status,
    priceLevel: result.price_level,
    photoUrl,
    photoUrls,
    types: result.types || []
  };
}

async function fetchPoiOriginalDetails(google, map, p) {
  if (!google?.maps?.places || !map || !p) return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const service = new google.maps.places.PlacesService(map);
  const detailFields = [
    'name',
    'formatted_address',
    'vicinity',
    'rating',
    'user_ratings_total',
    'reviews',
    'opening_hours',
    'photos',
    'website',
    'url',
    'formatted_phone_number',
    'international_phone_number',
    'business_status',
    'price_level',
    'types'
  ];

  // Fast path: many POIs already carry Google place IDs.
  const directIds = [
    normalizeGooglePlaceId(p?.placeId),
    normalizeGooglePlaceId(p?.place_id),
    normalizeGooglePlaceId(p?.id)
  ].filter(Boolean);
  for (const placeId of [...new Set(directIds)]) {
    const { result } = await placeDetailsPromise(service, { placeId, fields: detailFields });
    const mapped = mapDetailsResult(result);
    if (mapped) return mapped;
  }

  // Fallback 1: text query around location.
  const query = `${String(p?.name || '').slice(0, 100)} ${String(p?.category || '').slice(0, 60)}`.trim();
  if (query) {
    const { results } = await placeFindFromQueryPromise(service, {
      query,
      fields: ['place_id', 'geometry', 'name'],
      locationBias: new google.maps.Circle({
        center: { lat, lng },
        radius: 250
      })
    });
    const findPick = [...results]
      .filter((r) => Number.isFinite(Number(r?.geometry?.location?.lat?.())) && Number.isFinite(Number(r?.geometry?.location?.lng?.())))
      .sort((a, b) => {
        const ad = Math.hypot((a.geometry.location.lat() - lat), (a.geometry.location.lng() - lng));
        const bd = Math.hypot((b.geometry.location.lat() - lat), (b.geometry.location.lng() - lng));
        return ad - bd;
      })[0];
    if (findPick?.place_id) {
      const { result } = await placeDetailsPromise(service, { placeId: findPick.place_id, fields: detailFields });
      const mapped = mapDetailsResult(result);
      if (mapped) return mapped;
    }
  }

  // Fallback 2: nearby search + nearest match.
  const { results } = await placeSearchPromise(service, {
    location: { lat, lng },
    radius: 220,
    keyword: String(p.name || '').slice(0, 120)
  });
  if (!results.length) return null;
  const pick = [...results]
    .filter((r) => Number.isFinite(Number(r?.geometry?.location?.lat?.())) && Number.isFinite(Number(r?.geometry?.location?.lng?.())))
    .sort((a, b) => {
      const ad = Math.hypot((a.geometry.location.lat() - lat), (a.geometry.location.lng() - lng));
      const bd = Math.hypot((b.geometry.location.lat() - lat), (b.geometry.location.lng() - lng));
      return ad - bd;
    })[0];
  if (!pick?.place_id) return null;
  const { result } = await placeDetailsPromise(service, { placeId: pick.place_id, fields: detailFields });
  return mapDetailsResult(result);
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
  mapZoom = DEFAULT_ZOOM,
  onCancelRoute,
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
  const [activePoiPanel, setActivePoiPanel] = useState(null);
  const [activeLocalPanel, setActiveLocalPanel] = useState(null);
  const [activePoiPanelLoading, setActivePoiPanelLoading] = useState(false);
  const [activePoiPhotoIndex, setActivePoiPhotoIndex] = useState(0);
  const [placePhotosByKey, setPlacePhotosByKey] = useState({});
  const [photoUploadBusy, setPhotoUploadBusy] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState('');
  const [photoUploadTarget, setPhotoUploadTarget] = useState(null);

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
    libraries: GOOGLE_MAPS_LIBRARIES
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
  const activePopupBusinessIdRef = useRef('');
  const poiDetailsReqSeqRef = useRef(0);
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
  const panelDetails = activePoiPanel?.details || null;
  const panelPoi = activePoiPanel?.poi || null;
  const localPhotoInputRef = useRef(null);
  const publicPhotoInputRef = useRef(null);
  const panelPhotoUrls = useMemo(() => {
    const urls = Array.isArray(panelDetails?.photoUrls) ? panelDetails.photoUrls.filter(Boolean) : [];
    if (urls.length) return urls;
    const publicKey =
      panelPoi && Number.isFinite(Number(panelPoi.lat)) && Number.isFinite(Number(panelPoi.lng)) ?
        `public:${Number(panelPoi.lat).toFixed(5)},${Number(panelPoi.lng).toFixed(5)}:${String(panelPoi.name || '').toLowerCase().slice(0, 80)}` :
        '';
    const fromStore = Array.isArray(placePhotosByKey[publicKey]) ? placePhotosByKey[publicKey] : [];
    if (fromStore.length > 0) {
      return fromStore.map((p) => toAssetUrl(p.imageUrl)).filter(Boolean);
    }
    return panelDetails?.photoUrl ? [panelDetails.photoUrl] : [];
  }, [panelDetails, panelPoi, placePhotosByKey]);
  const panelPhotoCount = panelPhotoUrls.length;
  const clampedPhotoIndex = panelPhotoCount ? Math.max(0, Math.min(activePoiPhotoIndex, panelPhotoCount - 1)) : 0;
  const activePanelPhotoUrl = panelPhotoCount ? panelPhotoUrls[clampedPhotoIndex] : '';

  useEffect(() => {
    if (!panelPhotoCount) {
      if (activePoiPhotoIndex !== 0) setActivePoiPhotoIndex(0);
      return;
    }
    if (clampedPhotoIndex !== activePoiPhotoIndex) setActivePoiPhotoIndex(clampedPhotoIndex);
  }, [panelPhotoCount, clampedPhotoIndex, activePoiPhotoIndex]);

  useEffect(() => {
    if (!activePoiPanel?.poi) return;
    const la = Number(activePoiPanel.poi.lat);
    const lo = Number(activePoiPanel.poi.lng);
    const stillExists = (pois || []).some((p) => Number(p?.lat) === la && Number(p?.lng) === lo);
    if (!stillExists) {
      setActivePoiPanel(null);
      setActivePoiPanelLoading(false);
      setActivePoiPhotoIndex(0);
    }
  }, [activePoiPanel, pois]);
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
      if (merchantCount > 0 || poiCount > 0) {
        return `Area · ${merchantCount} local · ${poiCount} public`;
      }
      return `${radiusKmLabel} radius · search + Apply`;
    }
    if (searchHasNoResults && !isSearching) {
      return `No places found for "${q}" (within ${radiusKmLabel})`;
    }
    if (isSearching) {
      return `Searching… ${merchantCount} local · ${poiCount} public · ${radiusKmLabel}`;
    }
    return `${radiusKmLabel} · ${merchantCount} local · ${poiCount} public`;
  })();

  const closePoiPanel = () => {
    setActivePoiPanel(null);
    setActivePoiPanelLoading(false);
    setActivePoiPhotoIndex(0);
  };
  const closeLocalPanel = () => {
    setActiveLocalPanel(null);
  };
  const closeDetailPanels = () => {
    closePoiPanel();
    closeLocalPanel();
  };

  const panelTitle = panelDetails?.name || panelPoi?.name || 'Public place';
  const panelCategoryRaw = panelPoi?.category || panelDetails?.types?.[0] || 'place';
  const panelCategory = String(panelCategoryRaw).replace(/_/g, ' ');
  const panelRatingNum = Number(panelDetails?.rating ?? panelPoi?.rating);
  const panelStars = Number.isFinite(panelRatingNum) ? panelRatingNum.toFixed(1) : 'N/A';
  const panelRatingsCount = Number(panelDetails?.userRatingsTotal || panelDetails?.user_ratings_total || 0);
  const panelAddress =
    panelDetails?.formattedAddress || panelDetails?.vicinity || (
      Number.isFinite(Number(panelPoi?.lat)) && Number.isFinite(Number(panelPoi?.lng)) ?
        `${Number(panelPoi.lat).toFixed(5)}, ${Number(panelPoi.lng).toFixed(5)}` :
        'Location not available'
    );
  const panelWebsite = String(panelDetails?.website || '').trim();
  const panelMapsUrl = String(panelDetails?.googleMapsUrl || '').trim() || (
    Number.isFinite(Number(panelPoi?.lat)) && Number.isFinite(Number(panelPoi?.lng)) ?
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${panelPoi.lat},${panelPoi.lng}`)}` :
      ''
  );
  const panelOpenNow = panelDetails?.openingHours?.openNow;
  const panelWeekdayRows = Array.isArray(panelDetails?.openingHours?.weekdayText) ? panelDetails.openingHours.weekdayText : [];
  const panelPhone = String(panelDetails?.formattedPhoneNumber || panelDetails?.internationalPhoneNumber || '').trim();
  const panelPhoneHref = panelPhone ? `tel:${panelPhone.replace(/[^\d+]/g, '')}` : '';
  const panelPriceLevel = Number(panelDetails?.priceLevel ?? panelDetails?.price_level);
  const panelPriceText = Number.isFinite(panelPriceLevel) && panelPriceLevel >= 0 && panelPriceLevel <= 4 ? '₹'.repeat(Math.max(1, panelPriceLevel + 1)) : '';
  const panelReviews = Array.isArray(panelDetails?.reviews) ? panelDetails.reviews.slice(0, 4) : [];
  const localPanelBusiness = activeLocalPanel?.business || null;
  const localPanelName = localPanelBusiness?.mapDisplayName || localPanelBusiness?.name || 'Local place';
  const localPanelAddress = String(localPanelBusiness?.address || '').trim() || 'Location not available';
  const localPanelCategory = String(localPanelBusiness?.category || 'local');
  const localPanelRating = Number(localPanelBusiness?.rating);
  const localPanelDistance = Number(localPanelBusiness?.distanceMeters);
  const localPanelDistanceLabel = Number.isFinite(localPanelDistance) ?
    (localPanelDistance < 1000 ? `${Math.round(localPanelDistance)} m` : `${(localPanelDistance / 1000).toFixed(2)} km`) :
    'N/A';
  const localPanelDescription = String(localPanelBusiness?.description || localPanelBusiness?.localSourcingNote || '').trim();
  const localPanelMenu = String(localPanelBusiness?.menuCatalogFileUrl || '').trim();
  const localPanelMenuAbs = getAssetUrl(localPanelMenu);
  const localPanelCrowd = crowdLabel(localPanelBusiness?.crowdLevel);
  const localPanelCrowdNum = Math.max(0, Math.min(100, Number(localPanelBusiness?.crowdLevel) || 0));
  const localPanelIsRedPin = Boolean(localPanelBusiness?.localVerification?.redPin);
  const localPanelHasLiveDeal = Boolean(activeLocalPanel?.hasLiveDeal);
  const localPrimaryPhoto = useMemo(() => {
    const key = localPanelBusiness?._id ? `local:${String(localPanelBusiness._id)}` : '';
    const fromStore = key && Array.isArray(placePhotosByKey[key]) ? placePhotosByKey[key] : [];
    if (fromStore.length > 0) return toAssetUrl(fromStore[0].imageUrl);
    const firstBusinessImage = Array.isArray(localPanelBusiness?.images) ? localPanelBusiness.images.find((x) => String(x || '').trim()) : '';
    return toAssetUrl(firstBusinessImage);
  }, [localPanelBusiness, placePhotosByKey]);

  const localPlaceKey = localPanelBusiness?._id ? `local:${String(localPanelBusiness._id)}` : '';
  const publicPlaceKey =
    panelPoi && Number.isFinite(Number(panelPoi.lat)) && Number.isFinite(Number(panelPoi.lng)) ?
      `public:${Number(panelPoi.lat).toFixed(5)},${Number(panelPoi.lng).toFixed(5)}:${String(panelPoi.name || '').toLowerCase().slice(0, 80)}` :
      '';
  const activeLocalPhotos = localPlaceKey && Array.isArray(placePhotosByKey[localPlaceKey]) ? placePhotosByKey[localPlaceKey] : [];
  const activePublicPhotos = publicPlaceKey && Array.isArray(placePhotosByKey[publicPlaceKey]) ? placePhotosByKey[publicPlaceKey] : [];
  const localPrimaryPhotoRow = activeLocalPhotos[0] || null;
  const publicPrimaryPhotoRow = activePublicPhotos[0] || null;
  const myLocalUploads = activeLocalPhotos.filter((p) => p?.isMine);
  const myPublicUploads = activePublicPhotos.filter((p) => p?.isMine);
  const removableLocalRow =
    localPrimaryPhotoRow?.isMine ? localPrimaryPhotoRow : myLocalUploads[0] || null;
  const removablePublicRow =
    publicPrimaryPhotoRow?.isMine ? publicPrimaryPhotoRow : myPublicUploads[0] || null;

  useEffect(() => {
    const bid = String(localPanelBusiness?._id || '').trim();
    if (!bid) return;
    const key = `local:${bid}`;
    api.get('/place-photos', {
      params: { placeType: 'local', businessId: bid }
    }).then(({ data }) => {
      const rows = Array.isArray(data) ? data : [];
      setPlacePhotosByKey((prev) => ({ ...prev, [key]: rows }));
    }).catch(() => {});
  }, [localPanelBusiness?._id]);

  useEffect(() => {
    const lat = Number(panelPoi?.lat);
    const lng = Number(panelPoi?.lng);
    const placeName = String(panelPoi?.name || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = `public:${lat.toFixed(5)},${lng.toFixed(5)}:${placeName.toLowerCase().slice(0, 80)}`;
    api.get('/place-photos', {
      params: { placeType: 'public', lat, lng, placeName }
    }).then(({ data }) => {
      const rows = Array.isArray(data) ? data : [];
      setPlacePhotosByKey((prev) => ({ ...prev, [key]: rows }));
    }).catch(() => {});
  }, [panelPoi?.lat, panelPoi?.lng, panelPoi?.name]);

  const triggerUploadPicker = (kind, visibility) => {
    setPhotoUploadError('');
    if (kind === 'local') {
      const bid = String(localPanelBusiness?._id || '').trim();
      if (!bid) return;
      setPhotoUploadTarget({ kind: 'local', key: `local:${bid}`, visibility: visibility === 'public' ? 'public' : 'private' });
      localPhotoInputRef.current?.click?.();
      return;
    }
    const pla = Number(panelPoi?.lat);
    const plo = Number(panelPoi?.lng);
    if (!Number.isFinite(pla) || !Number.isFinite(plo)) return;
    const k = `public:${pla.toFixed(5)},${plo.toFixed(5)}:${String(panelPoi?.name || '').toLowerCase().slice(0, 80)}`;
    setPhotoUploadTarget({ kind: 'public', key: k, visibility: visibility === 'public' ? 'public' : 'private' });
    publicPhotoInputRef.current?.click?.();
  };

  const onPlacePhotoFileSelected = async (e) => {
    const file = e?.target?.files?.[0];
    e.target.value = '';
    if (!file || !photoUploadTarget?.key) return;
    setPhotoUploadBusy(true);
    setPhotoUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/uploads/chat-media', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const uploadPath = String(data?.url || '').trim();
      const url = toAssetUrl(uploadPath);
      if (!url) throw new Error('No uploaded image URL returned');
      const payload =
        photoUploadTarget.kind === 'local' ?
          {
            placeType: 'local',
            businessId: String(localPanelBusiness?._id || ''),
            placeName: localPanelName,
            imageUrl: uploadPath || url,
            visibility: photoUploadTarget.visibility || 'private'
          } :
          {
            placeType: 'public',
            placeName: String(panelPoi?.name || 'Public place'),
            lat: Number(panelPoi?.lat),
            lng: Number(panelPoi?.lng),
            imageUrl: uploadPath || url,
            visibility: photoUploadTarget.visibility || 'private'
          };
      const created = await api.post('/place-photos', payload);
      const createdRow = created?.data || null;
      if (createdRow?._id) {
        setPlacePhotosByKey((prev) => {
          const rows = Array.isArray(prev[photoUploadTarget.key]) ? prev[photoUploadTarget.key] : [];
          return { ...prev, [photoUploadTarget.key]: [createdRow, ...rows] };
        });
      }
    } catch (err) {
      setPhotoUploadError(err?.response?.data?.error || 'Could not upload photo right now.');
    } finally {
      setPhotoUploadBusy(false);
    }
  };

  const removeUploadedPhoto = async (photoRow, key) => {
    if (!photoRow?._id || !key) return;
    setPhotoUploadBusy(true);
    setPhotoUploadError('');
    try {
      await api.delete(`/place-photos/${photoRow._id}`);
      setPlacePhotosByKey((prev) => {
        const rows = Array.isArray(prev[key]) ? prev[key] : [];
        return { ...prev, [key]: rows.filter((x) => String(x?._id) !== String(photoRow._id)) };
      });
    } catch (err) {
      setPhotoUploadError(err?.response?.data?.error || 'Could not remove photo.');
    } finally {
      setPhotoUploadBusy(false);
    }
  };


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
      const icon = buildMapPinIcon(google, {
        fill: hasLiveDeal ? PIN_COLORS.LOCAL_RED_DEAL : PIN_COLORS.LOCAL_RED,
        dot: hasLiveDeal ? '#fee2e2' : '#ffffff',
        size: isHighlighted ? 44 : 40,
        pulse: true
      });

      const marker = new google.maps.Marker({
        position: { lat: Number(lat), lng: Number(lng) },
        icon,
        zIndex: isHighlighted ? 900 : 300
      });

      marker.addListener('click', () => {
        const isHighlighted = highlightedIdRef.current && String(b?._id) === highlightedIdRef.current;
        activePopupBusinessIdRef.current = '';
        closePoiPanel();
        setActiveLocalPanel({
          business: { ...b, distanceMeters },
          hasLiveDeal,
          isHighlighted
        });
        infoWindow.close();
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
      const q = String(categoryFilter || '').trim();
      const isExactSearchMatch = q ? poiMatchesPreciseQuery(q, p) : false;
      const isMayMatch = q ? !isExactSearchMatch : false;
      const isSearchPrimary = Boolean(highlightedPoiLatLng && poiLatLngMatch(p, highlightedPoiLatLng));
      const isPerfectMatch = isSearchPrimary || isExactSearchMatch;
      const poiFill = isPerfectMatch ? PIN_COLORS.EXACT_BLUE : PIN_COLORS.MAYBE_GREY;
      const poiDot = isPerfectMatch ? '#dbeafe' : '#e5e7eb';
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        icon: buildMapPinIcon(google, {
          fill: poiFill,
          dot: poiDot,
          size: 38
        }),
        zIndex: isPerfectMatch ? 560 : 420
      });

      marker.addListener('click', () => {
        closeLocalPanel();
        activePopupBusinessIdRef.current = '';
        const reqSeq = ++poiDetailsReqSeqRef.current;
        setActivePoiPhotoIndex(0);
        setActivePoiPanelLoading(true);
        setActivePoiPanel({
          poi: p,
          details: null,
          isSearchPrimary,
          isExactSearchMatch,
          isMayMatch
        });
        // Public-place details are shown in the side panel; avoid duplicate map popup content.
        infoWindow.close();
        fetchPoiOriginalDetails(google, map, p).
          then((details) => {
            if (reqSeq !== poiDetailsReqSeqRef.current) return;
            setActivePoiPanel({
              poi: p,
              details: details || null,
              isSearchPrimary,
              isExactSearchMatch,
              isMayMatch
            });
            setActivePoiPanelLoading(false);
          }).
          catch(() => {
            if (reqSeq !== poiDetailsReqSeqRef.current) return;
            setActivePoiPanel({
              poi: p,
              details: null,
              isSearchPrimary,
              isExactSearchMatch,
              isMayMatch
            });
            setActivePoiPanelLoading(false);
          });
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

    // Keep currently open local-place popup refreshed when merchant crowd data changes.
    const activeBusinessId = String(activePopupBusinessIdRef.current || '');
    if (activeBusinessId) {
      const latest = (businesses || []).find((b) => String(b?._id) === activeBusinessId);
      const marker = businessMarkerByIdRef.current.get(activeBusinessId);
      if (latest && marker) {
        const popupModel = {
          ...latest,
          __hasLiveDeal: offerIds.has(activeBusinessId),
          distanceMeters:
            userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng) ?
              (() => {
                const loc = latest?.location?.coordinates || [];
                const lng = Number(loc?.[0]);
                const lat = Number(loc?.[1]);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                const R = 6371e3;
                const phi1 = userLocation.lat * Math.PI / 180;
                const phi2 = lat * Math.PI / 180;
                const dPhi = (lat - userLocation.lat) * Math.PI / 180;
                const dLambda = (lng - userLocation.lng) * Math.PI / 180;
                const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
                return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              })() :
              null
        };
        infoWindow.setContent(
          businessPopupHtml(popupModel, {
            isHighlighted: highlightedIdRef.current && String(latest?._id) === highlightedIdRef.current
          })
        );
        infoWindow.open({ map, anchor: marker });
      }
    }
  }, [isLoaded, loadError, userLocation, userLocationAccuracy, businesses, pois, offers, offerIds, effectiveHighlightBusinessId, highlightedPoiLatLng, budgetCapInr, categoryFilter]);

  useEffect(() => {
    const activeId = String(activeLocalPanel?.business?._id || '');
    if (!activeId) return;
    const latest = (businesses || []).find((b) => String(b?._id) === activeId);
    if (!latest) {
      setActiveLocalPanel(null);
      return;
    }
    setActiveLocalPanel((prev) => {
      if (!prev) return prev;
      const dist =
        userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng) ?
          (() => {
            const loc = latest?.location?.coordinates || [];
            const lng = Number(loc?.[0]);
            const lat = Number(loc?.[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const R = 6371e3;
            const phi1 = userLocation.lat * Math.PI / 180;
            const phi2 = lat * Math.PI / 180;
            const dPhi = (lat - userLocation.lat) * Math.PI / 180;
            const dLambda = (lng - userLocation.lng) * Math.PI / 180;
            const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          })() :
          prev.business?.distanceMeters || null;
      return {
        ...prev,
        hasLiveDeal: offerIds.has(activeId),
        business: { ...latest, distanceMeters: dist }
      };
    });
  }, [activeLocalPanel?.business?._id, businesses, offerIds, userLocation?.lat, userLocation?.lng]);


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
      icon: destinationPoint?.kind === 'local' ?
        buildMapPinIcon(google, { fill: '#ef4444', dot: '#ffffff', size: 33 }) :
        buildMapPinIcon(google, { fill: '#2563eb', dot: '#dbeafe', size: 33 }),
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
      <div className="relative h-[clamp(340px,72dvh,560px)] min-h-[340px] sm:h-[clamp(440px,70dvh,620px)]">
        {highlightedPoiLatLng && typeof onDismissHighlightedPoi === 'function' &&
        <button
          type="button"
          className="absolute top-3 left-3 z-[6] flex h-11 w-11 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-500 shadow-lg transition-all duration-200 hover:scale-105 hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
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
            closeDetailPanels();
            if (!enablePinSelection || typeof onLocationChange !== 'function') return;
            const ll = e?.latLng;
            if (!ll) return;
            onLocationChange(ll.lat(), ll.lng());
          }}
          center={safeCenter}
          zoom={Number.isFinite(Number(mapZoom)) ? Number(mapZoom) : DEFAULT_ZOOM}
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
        {activeLocalPanel && localPanelBusiness && (
          <aside className="absolute right-3 top-3 z-[8] w-[min(92vw,380px)] max-h-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-rose-400/40 bg-[#2f1212]/95 text-rose-50 shadow-2xl backdrop-blur-sm">
            <div className="flex items-start justify-between gap-2 border-b border-rose-400/30 px-4 py-3">
              <div>
                <p className="text-base font-semibold leading-tight">{localPanelName}</p>
                <p className="mt-1 text-xs capitalize text-rose-200/90">{localPanelCategory}</p>
              </div>
              <button
                type="button"
                onClick={closeLocalPanel}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-400/35 text-rose-100 transition hover:bg-rose-200/10"
                aria-label="Close local place details"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(100%-3.6rem)] overflow-y-auto p-4 space-y-3 text-sm">
              {localPrimaryPhoto ? (
                <div className="relative overflow-hidden rounded-xl border border-rose-400/30 bg-[#3b1515]">
                  <img src={localPrimaryPhoto} alt={localPanelName} className="h-44 w-full object-cover" />
                  {removableLocalRow &&
                  <button
                    type="button"
                    onClick={() => removeUploadedPhoto(removableLocalRow, localPlaceKey)}
                    disabled={photoUploadBusy}
                    className="absolute right-2 top-2 rounded-md border border-rose-200 bg-white/90 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-white disabled:opacity-60">
                      Remove
                    </button>
                  }
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-rose-300/50 bg-[#3b1515] px-3 py-4 text-xs text-rose-100/90">
                  <p>No photo yet for this local place.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => triggerUploadPicker('local', 'private')}
                      disabled={photoUploadBusy}
                      className="rounded-lg border border-rose-300/45 bg-rose-900/30 px-2.5 py-1.5 text-xs font-semibold hover:bg-rose-900/45 disabled:opacity-60">
                      Save for yourself
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerUploadPicker('local', 'public')}
                      disabled={photoUploadBusy}
                      className="rounded-lg border border-rose-300/45 bg-rose-900/30 px-2.5 py-1.5 text-xs font-semibold hover:bg-rose-900/45 disabled:opacity-60">
                      Save for all
                    </button>
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-rose-400/30 bg-[#3b1515] p-3">
                <p>⭐ {Number.isFinite(localPanelRating) ? localPanelRating.toFixed(1) : 'N/A'} · {localPanelDistanceLabel}</p>
                {localPanelHasLiveDeal && <p className="mt-1 text-xs font-medium text-rose-200">Flash deal live</p>}
                {localPanelIsRedPin && <p className="mt-1 text-xs font-medium text-rose-200">Verified local red pin</p>}
                {activeLocalPanel?.isHighlighted && <p className="mt-1 text-xs font-medium text-fuchsia-200">Highlighted match</p>}
              </div>
              <div className="rounded-xl border border-rose-400/30 bg-[#3b1515] p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-200/80">Address</p>
                <p>{localPanelAddress}</p>
              </div>
              {localPanelDescription && (
                <div className="rounded-xl border border-rose-400/30 bg-[#3b1515] p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-200/80">Description</p>
                  <p className="text-rose-100/95">{localPanelDescription}</p>
                </div>
              )}
              {localPanelCrowd && (
                <div className="rounded-xl border border-rose-400/30 bg-[#3b1515] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-200/80">Live crowd</p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-rose-900/60">
                    <div
                      className={`h-full rounded-full ${localPanelCrowdNum >= 66 ? 'bg-rose-300' : localPanelCrowdNum >= 33 ? 'bg-amber-300' : 'bg-emerald-300'}`}
                      style={{ width: `${localPanelCrowdNum}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-rose-100">{localPanelCrowd} · {localPanelCrowdNum}%</p>
                  <p className="mt-0.5 text-[11px] text-rose-200/80">{crowdFreshnessText(localPanelBusiness?.crowdLastPing)}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`goout-go-route text-xs ${localPanelHasLiveDeal ? 'bg-rose-600 hover:bg-rose-700' : 'goout-btn-primary'}`}
                  data-go-route="1"
                  data-lat={Number(localPanelBusiness?.location?.coordinates?.[1])}
                  data-lng={Number(localPanelBusiness?.location?.coordinates?.[0])}
                  data-kind="local"
                  data-business-id={String(localPanelBusiness?._id || '')}
                  data-label={encodeURIComponent(localPanelName)}
                >
                  Go
                </button>
                {localPanelMenuAbs ? (
                  <a
                    href={localPanelMenuAbs}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 rounded-lg border border-rose-400/35 bg-[#4a1a1a] text-xs font-medium text-rose-100 hover:bg-[#5c2323]"
                  >
                    View menu
                  </a>
                ) : (
                  <span className="px-3 py-2 rounded-lg border border-rose-400/25 bg-[#3b1515] text-xs text-rose-200/75">
                    Menu unavailable
                  </span>
                )}
              </div>
              {photoUploadError && <p className="text-xs text-rose-200">{photoUploadError}</p>}
              {removableLocalRow &&
              <div className="rounded-xl border border-rose-400/30 bg-[#3b1515] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-200/80">Your uploads</p>
                  <div className="mt-2 rounded-lg border border-rose-400/20 bg-[#2f1212] px-2.5 py-2">
                    <span className="text-[11px] text-rose-100">
                      {removableLocalRow.visibility === 'public' ? 'Saved for all' : 'Saved for yourself'}
                    </span>
                  </div>
                </div>
              }
            </div>
          </aside>
        )}
        {activePoiPanel && panelPoi && (
          <aside className="absolute right-3 top-3 z-[8] w-[min(92vw,380px)] max-h-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-emerald-400/40 bg-[#0f2f24]/95 text-emerald-50 shadow-2xl backdrop-blur-sm">
            <div className="flex items-start justify-between gap-2 border-b border-emerald-500/30 px-4 py-3">
              <div>
                <p className="text-base font-semibold leading-tight">{panelTitle}</p>
                <p className="mt-1 text-xs capitalize text-emerald-200/90">{panelCategory}</p>
              </div>
              <button
                type="button"
                onClick={closePoiPanel}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-500/35 text-emerald-100 transition hover:bg-emerald-200/10"
                aria-label="Close place details"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(100%-3.6rem)] overflow-y-auto p-4 space-y-3">
              {activePanelPhotoUrl ? (
                <div className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-[#102f24]">
                  <img src={activePanelPhotoUrl} alt={panelTitle} className="h-44 w-full object-cover" />
                  {panelPhotoCount > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActivePoiPhotoIndex((i) => (i - 1 + panelPhotoCount) % panelPhotoCount)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-emerald-500/40 bg-[#0f2f24]/90 px-2 py-1 text-xs"
                        aria-label="Previous photo"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivePoiPhotoIndex((i) => (i + 1) % panelPhotoCount)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-emerald-500/40 bg-[#0f2f24]/90 px-2 py-1 text-xs"
                        aria-label="Next photo"
                      >
                        ›
                      </button>
                      <div className="absolute bottom-2 right-2 rounded-full bg-[#0a1f18]/90 px-2 py-0.5 text-[11px] text-emerald-100">
                        {clampedPhotoIndex + 1}/{panelPhotoCount}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-500/30 bg-[#102f24] px-3 py-6 text-center text-xs text-emerald-200/80">
                  No photos available for this place.
                  <div className="mt-2">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => triggerUploadPicker('public', 'private')}
                        disabled={photoUploadBusy}
                        className="rounded-lg border border-emerald-400/40 bg-emerald-900/35 px-2.5 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-60">
                        Save for yourself
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerUploadPicker('public', 'public')}
                        disabled={photoUploadBusy}
                        className="rounded-lg border border-emerald-400/40 bg-emerald-900/35 px-2.5 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-60">
                        Save for all
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {activePanelPhotoUrl && removablePublicRow &&
              <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeUploadedPhoto(removablePublicRow, publicPlaceKey)}
                    disabled={photoUploadBusy}
                    className="rounded-md border border-emerald-300/60 bg-emerald-950/30 px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-950/50 disabled:opacity-60">
                    Remove your photo
                  </button>
                </div>
              }
              {photoUploadError && <p className="text-xs text-emerald-200">{photoUploadError}</p>}
              {removablePublicRow &&
              <div className="rounded-xl border border-emerald-500/30 bg-[#123627] p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200/80">Your uploads</p>
                  <div className="mt-2 rounded-lg border border-emerald-500/25 bg-[#0f2f24] px-2.5 py-2">
                    <span className="text-[11px] text-emerald-100">
                      {removablePublicRow.visibility === 'public' ? 'Saved for all' : 'Saved for yourself'}
                    </span>
                  </div>
                </div>
              }

              <div className="rounded-xl border border-emerald-500/30 bg-[#123627] p-3 text-sm">
                <p>⭐ {panelStars}{panelRatingsCount > 0 ? ` (${panelRatingsCount.toLocaleString()} reviews)` : ''}{panelPriceText ? ` · ${panelPriceText}` : ''}</p>
                {panelOpenNow === true && <p className="mt-1 text-xs font-medium text-emerald-200">Open now</p>}
                {panelOpenNow === false && <p className="mt-1 text-xs font-medium text-rose-200">Closed now</p>}
                {activePoiPanelLoading && <p className="mt-1 text-xs text-emerald-200/90">Loading more place details...</p>}
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-[#123627] p-3 text-sm space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200/80">Address</p>
                <p className="text-emerald-50">{panelAddress}</p>
                {panelPhone && <p className="text-xs text-emerald-200/90">Phone: {panelPhone}</p>}
              </div>

              {!!panelWeekdayRows.length && (
                <div className="rounded-xl border border-emerald-500/30 bg-[#123627] p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200/80">Opening hours</p>
                  <div className="mt-2 space-y-1 text-xs text-emerald-100">
                    {panelWeekdayRows.map((row) => (
                      <p key={row}>{row}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="goout-btn-primary text-xs"
                  data-go-route="1"
                  data-lat={panelPoi?.lat}
                  data-lng={panelPoi?.lng}
                  data-kind="poi"
                  data-label={encodeURIComponent(panelPoi?.name || panelTitle)}
                >
                  Go
                </button>
                {panelMapsUrl && (
                  <a
                    href={panelMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 rounded-lg border border-emerald-500/35 bg-[#143b2b] text-xs font-medium text-emerald-100 hover:bg-[#194734]"
                  >
                    Open in Maps
                  </a>
                )}
                {panelWebsite && (
                  <a
                    href={panelWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 rounded-lg border border-emerald-500/35 bg-[#143b2b] text-xs font-medium text-emerald-100 hover:bg-[#194734]"
                  >
                    Website
                  </a>
                )}
                {panelPhoneHref && (
                  <a
                    href={panelPhoneHref}
                    className="px-3 py-2 rounded-lg border border-emerald-500/35 bg-[#143b2b] text-xs font-medium text-emerald-100 hover:bg-[#194734]"
                  >
                    Call
                  </a>
                )}
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-[#123627] p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200/80">Reviews</p>
                {panelReviews.length ? (
                  <div className="mt-2 space-y-2">
                    {panelReviews.map((r, idx) => {
                      const rr = Number(r?.rating);
                      const rStars = Number.isFinite(rr) ? `⭐ ${rr.toFixed(1)}` : '';
                      const author = String(r?.author_name || r?.authorAttribution?.displayName || 'Visitor');
                      const txt = summarizeReviewText(r?.text || r?.originalText || '');
                      return (
                        <div key={`${author}-${idx}`} className="rounded-lg border border-emerald-500/25 bg-[#0f2f24] px-2.5 py-2">
                          <p className="text-[11px] font-semibold text-emerald-100">{author}{rStars ? ` · ${rStars}` : ''}</p>
                          <p className="mt-1 text-[11px] text-emerald-200/90">{txt || 'No text review provided.'}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-emerald-200/85">No review snippets available.</p>
                )}
              </div>
            </div>
          </aside>
        )}
        {(isSearching || showResultsLoader) && (
          <div className="absolute inset-0 z-[7] pointer-events-none bg-white flex items-center justify-center">
            <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow">
              Loading…
            </div>
          </div>
        )}
        {enablePinSelection &&
        <div className="absolute top-3 left-3 z-[6] rounded-lg bg-emerald-50/95 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 shadow-sm">
            Pin mode: tap map to set location.
          </div>
        }
      </div>
      <input
        ref={localPhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPlacePhotoFileSelected}
      />
      <input
        ref={publicPhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPlacePhotoFileSelected}
      />
      <div className="p-4 bg-slate-50 border-t flex flex-col gap-1 text-sm">
        <span><strong>You:</strong> {userLocationText}</span>
        <span><strong>Public:</strong> {q ? poiCount : 0}</span>
        <span><strong>Local:</strong> {q ? merchantCount : 0}</span>
        {destinationPoint && typeof onCancelRoute === 'function' && (
          <button
            type="button"
            onClick={onCancelRoute}
            className="mt-2 inline-flex w-fit items-center rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
          >
            Cancel route
          </button>
        )}
        {Number.isFinite(Number(budgetCapInr)) && Number(budgetCapInr) > 0 &&
        <span className="text-xs text-slate-600">
            Budget: grey = over cap. Big green = strong eco tags.
          </span>
        }
        {Array.isArray(compareRouteOverlays) && compareRouteOverlays.length > 0 &&
        <span className="text-xs text-slate-600">
            Compare: green = top pick; grey = alt.
          </span>
        }
        {mapVisualTheme === 'green' &&
        <span className="text-xs text-emerald-800">
            Green: softer map + animated eco route (Green tab).
          </span>
        }
        {q &&
        <span className="text-xs text-slate-600">
            Search pins: blue = exact match, grey = may match, red = local business.
          </span>
        }
      </div>
    </div>);

}

export default DiscoveryMap;