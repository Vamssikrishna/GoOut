import { setTimeout as delay } from 'node:timers/promises';

function haversineMeters(la1, lo1, la2, lo2) {
  const R = 6371e3;
  const phi1 = la1 * Math.PI / 180;
  const phi2 = la2 * Math.PI / 180;
  const dPhi = (la2 - la1) * Math.PI / 180;
  const dLambda = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * One Text Search call per invocation (avoids 429 from burst multi-query).
 */
async function fetchGooglePlacesTextOnce({ searchTerm, latNum, lngNum, radiusMeters }) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!apiKey || !searchTerm) return [];

  const body = JSON.stringify({
    textQuery: searchTerm,
    maxResultCount: 15,
    languageCode: 'en',
    locationBias: {
      circle: {
        center: { latitude: latNum, longitude: lngNum },
        radius: Math.min(Math.max(radiusMeters, 500), 50000)
      }
    }
  });

  const doReq = () =>
    fetchWithTimeout(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.primaryType,places.formattedAddress'
        },
        body
      },
      12000
    );

  let resp = await doReq();
  if (resp.status === 429) {
    await delay(2200);
    resp = await doReq();
  }

  if (!resp.ok) {
    if (resp.status !== 429) {
      try {
        const errText = await resp.text();
        console.warn('[publicPlaces] Places searchText HTTP', resp.status, errText.slice(0, 200));
      } catch {
        /* ignore */
      }
    }
    return [];
  }

  const data = await resp.json();
  const places = Array.isArray(data?.places) ? data.places : [];
  return places
    .map((p) => {
      const la = Number(p?.location?.latitude);
      const lo = Number(p?.location?.longitude);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
      return {
        id: p.id || `${la},${lo}`,
        name: p.displayName?.text || p.formattedAddress || 'Unnamed place',
        category: p.primaryType || 'public_space',
        lat: la,
        lng: lo,
        source: 'google_places'
      };
    })
    .filter(Boolean);
}

/** Richer OSM: parks + libraries + attractions + civic/cultural places. */
async function fetchOsmPublicSpaces(latNum, lngNum, radiusM) {
  const r = Math.min(Math.max(Math.round(radiusM), 200), 25000);
  const query = `[out:json][timeout:22];
(
  node(around:${r},${latNum},${lngNum})[leisure=park];
  way(around:${r},${latNum},${lngNum})[leisure=park];
  node(around:${r},${latNum},${lngNum})[leisure=garden];
  way(around:${r},${latNum},${lngNum})[leisure=garden];
  node(around:${r},${latNum},${lngNum})[leisure=playground];
  way(around:${r},${latNum},${lngNum})[leisure=playground];
  node(around:${r},${latNum},${lngNum})[tourism=attraction];
  way(around:${r},${latNum},${lngNum})[tourism=attraction];
  node(around:${r},${latNum},${lngNum})[tourism=museum];
  way(around:${r},${latNum},${lngNum})[tourism=museum];
  node(around:${r},${latNum},${lngNum})[tourism=gallery];
  way(around:${r},${latNum},${lngNum})[tourism=gallery];
  node(around:${r},${latNum},${lngNum})[historic];
  way(around:${r},${latNum},${lngNum})[historic];
  node(around:${r},${latNum},${lngNum})[amenity=library];
  way(around:${r},${latNum},${lngNum})[amenity=library];
  node(around:${r},${latNum},${lngNum})[amenity=community_centre];
  way(around:${r},${latNum},${lngNum})[amenity=community_centre];
  node(around:${r},${latNum},${lngNum})[amenity=theatre];
  way(around:${r},${latNum},${lngNum})[amenity=theatre];
);
out center tags;`;

  const doOsm = () =>
    fetchWithTimeout(
      'https://overpass-api.de/api/interpreter',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString()
      },
      14000
    );

  let resp = await doOsm();
  if (resp.status === 429) {
    await delay(2500);
    resp = await doOsm();
  }

  if (!resp.ok) return [];
  const data = await resp.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const merged = new Map();

  elements.forEach((e) => {
    const latVal = typeof e.lat === 'number' ? e.lat : e.center?.lat;
    const lngVal = typeof e.lon === 'number' ? e.lon : e.center?.lon;
    if (typeof latVal !== 'number' || typeof lngVal !== 'number') return;
    const name = e.tags?.name || 'Unnamed public space';
    const key = `${name.toLowerCase()}|${latVal.toFixed(4)}|${lngVal.toFixed(4)}`;
    if (merged.has(key)) return;
    const cat = e.tags?.leisure || e.tags?.tourism || e.tags?.amenity || 'public_space';
    merged.set(key, {
      id: `osm-${e.type}-${e.id}`,
      name,
      category: cat,
      lat: latVal,
      lng: lngVal,
      source: 'osm'
    });
  });

  return Array.from(merged.values())
    .map((p) => ({
      ...p,
      distanceMeters: haversineMeters(latNum, lngNum, p.lat, p.lng)
    }))
    .filter((p) => p.distanceMeters <= r * 1.2)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 24);
}

/**
 * Google Text Search query tuned from the user's message (libraries, museums, shade, etc.).
 */
export function buildGooglePlacesConciergeQuery(userMessage) {
  const t = String(userMessage || '').toLowerCase();
  const parts = [
    'public places points of interest civic cultural landmarks',
    'parks public gardens plazas playgrounds outdoor recreation walking paths',
    'libraries museums galleries monuments memorials community centers theatres'
  ];
  if (/\b(library|libraries|reading room)\b/.test(t)) parts.push('public library');
  if (/\b(museum|art gallery|gallery)\b/.test(t)) parts.push('museum art gallery');
  if (/\b(monument|memorial|historic|heritage site)\b/.test(t)) parts.push('historic monument landmark');
  if (/\b(community center|community centre|civic center|town hall)\b/.test(t)) parts.push('community center civic');
  if (/\b(shade|shaded|trees|woodland|forest trail)\b/.test(t)) parts.push('tree park woodland garden');
  if (/\b(seating|bench|sit|plaza|square)\b/.test(t)) parts.push('public square plaza seating');
  if (/\b(quiet)\b/.test(t)) parts.push('quiet park library garden');
  if (/\b(free).*\b(visit|landmark|attraction|museum)\b|\b(free things)\b/.test(t)) parts.push('free viewpoint landmark');
  if (/\b(recycl)\b/.test(t)) parts.push('recycling drop-off');
  if (/\b(cultural|history|historical|heritage)\b/.test(t)) parts.push('heritage site museum monument gallery');
  if (/\b(indoor|inside)\b/.test(t)) parts.push('indoor public museum library gallery');
  if (/\b(kids|family|children)\b/.test(t)) parts.push('family park playground children museum');
  return [...new Set(parts)].join(' ');
}

/**
 * Parks, libraries, attractions, etc. near a point.
 * At most one Google Places request; OSM fills gaps (also one request).
 * @param {string} [userMessage] optional user text to bias Google search.
 */
export async function fetchPublicSpacesNear(lat, lng, radiusMeters = 5000, userMessage = '', opts = {}) {
  const maxResults = Math.min(80, Math.max(8, Number(opts.maxResults) || 20));
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return [];

  const merged = new Map();
  const add = (p) => {
    if (!p?.name || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
    const k = `${String(p.name).toLowerCase()}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
    if (!merged.has(k)) merged.set(k, p);
  };

  const searchTerm = buildGooglePlacesConciergeQuery(userMessage);

  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const batch = await fetchGooglePlacesTextOnce({
        searchTerm,
        latNum,
        lngNum,
        radiusMeters
      });
      batch.forEach(add);
    } catch (e) {
      console.warn('[publicPlaces] Google Places', e?.message || e);
    }
  }

  if (merged.size < 4) {
    try {
      const osm = await fetchOsmPublicSpaces(latNum, lngNum, radiusMeters);
      osm.forEach(add);
    } catch (e) {
      console.warn('[publicPlaces] OSM', e?.message || e);
    }
  }

  return Array.from(merged.values())
    .map((p) => ({
      ...p,
      distanceMeters: haversineMeters(latNum, lngNum, p.lat, p.lng)
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, maxResults);
}
