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
 * Google Places Text Search call.
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
          'X-Goog-FieldMask': [
            'places.id',
            'places.displayName',
            'places.location',
            'places.primaryType',
            'places.types',
            'places.formattedAddress',
            'places.rating',
            'places.userRatingCount',
            'places.priceLevel',
            'places.regularOpeningHours',
            'places.websiteUri',
            'places.nationalPhoneNumber',
            'places.editorialSummary'
          ].join(',')
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
        types: Array.isArray(p.types) ? p.types.slice(0, 8) : [],
        address: p.formattedAddress || '',
        rating: p.rating ?? null,
        ratingCount: p.userRatingCount ?? null,
        priceLevel: p.priceLevel || '',
        openingHoursText: Array.isArray(p.regularOpeningHours?.weekdayDescriptions) ?
          p.regularOpeningHours.weekdayDescriptions.slice(0, 7) :
          [],
        websiteUri: p.websiteUri || '',
        phone: p.nationalPhoneNumber || '',
        editorialSummary: p.editorialSummary?.text || '',
        lat: la,
        lng: lo,
        source: 'google_places'
      };
    })
    .filter(Boolean);
}

function hasAny(text, re) {
  return re.test(String(text || '').toLowerCase());
}

async function fetchGooglePlaceDetails(placeId) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  const id = String(placeId || '').trim();
  if (!apiKey || !id) return null;
  const resp = await fetchWithTimeout(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
    {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'id',
          'displayName',
          'formattedAddress',
          'primaryType',
          'types',
          'rating',
          'userRatingCount',
          'priceLevel',
          'regularOpeningHours',
          'websiteUri',
          'nationalPhoneNumber',
          'editorialSummary',
          'location'
        ].join(',')
      }
    },
    7000
  );
  if (!resp.ok) return null;
  const p = await resp.json();
  const la = Number(p?.location?.latitude);
  const lo = Number(p?.location?.longitude);
  return {
    id: p.id || id,
    name: p.displayName?.text || p.formattedAddress || 'Unnamed place',
    category: p.primaryType || 'public_space',
    types: Array.isArray(p.types) ? p.types.slice(0, 10) : [],
    address: p.formattedAddress || '',
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    priceLevel: p.priceLevel || '',
    openingHoursText: Array.isArray(p.regularOpeningHours?.weekdayDescriptions) ?
      p.regularOpeningHours.weekdayDescriptions.slice(0, 7) :
      [],
    websiteUri: p.websiteUri || '',
    phone: p.nationalPhoneNumber || '',
    editorialSummary: p.editorialSummary?.text || '',
    lat: Number.isFinite(la) ? la : null,
    lng: Number.isFinite(lo) ? lo : null,
    source: 'google_places_details'
  };
}

function buildGooglePlacesSearchTerms(userMessage) {
  const base = buildGooglePlacesConciergeQuery(userMessage);
  const t = String(userMessage || '').toLowerCase();
  const terms = [
    String(userMessage || '').trim(),
    base,
    'cafes restaurants shops parks attractions near me',
    'popular places food coffee shopping parks near me'
  ];

  // Add compact intent-specific terms for broader real-world place coverage.
  if (hasAny(t, /\b(cafe|cafes|café|coffee|espresso|latte|chai|tea|bakery|quiet|study|laptop|work)\b/)) {
    terms.push('cafes coffee shops tea bakeries near me');
    terms.push('quiet cafes coffee shops study friendly near me');
  }
  if (hasAny(t, /\b(food|eat|hungry|restaurant|lunch|dinner|breakfast|brunch|snack|meal|biryani|pizza|burger|dosa|idli)\b/)) {
    terms.push('restaurants food dining snacks near me');
  }
  if (hasAny(t, /\b(cheap|affordable|budget|price|under|below|low cost)\b/)) {
    terms.push('affordable cafes restaurants cheap eats near me');
  }
  if (hasAny(t, /\b(shop|shopping|store|gift|bookstore|books|clothes|fashion|market|artisan|handmade)\b/)) {
    terms.push('shops stores markets bookstores gifts near me');
  }
  if (hasAny(t, /\b(salon|spa|haircut|beauty)\b/)) {
    terms.push('salon spa beauty haircut near me');
  }
  if (hasAny(t, /\b(gym|fitness|yoga|workout)\b/)) {
    terms.push('gyms fitness yoga near me');
  }
  if (hasAny(t, /\b(bar|pub|drink|beer|wine|cocktail)\b/)) {
    terms.push('bars pubs drinks near me');
  }
  if (hasAny(t, /\b(park|garden|playground|outdoor|walk)\b/)) {
    terms.push('parks gardens playgrounds public outdoor spaces');
  }
  if (hasAny(t, /\b(library|museum|gallery|landmark|monument|historic|heritage)\b/)) {
    terms.push('libraries museums galleries landmarks monuments heritage');
  }
  if (hasAny(t, /\b(theater|theatre|cinema|movie|multiplex)\b/)) {
    terms.push('cinema movie theater multiplex');
  }
  if (hasAny(t, /\b(plaza|square|community|civic|public)\b/)) {
    terms.push('public plazas squares community civic places');
  }

  // Stable fallback terms so Gemini receives broad nearby Google context even
  // when the user's language is vague or misspelled.
  terms.push('public places points of interest near me');
  terms.push('nearby places to visit eat shop coffee');

  return [...new Set(terms.map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 7);
}

/** Richer OSM: food, cafes, shops, parks, attractions, and civic/cultural places. */
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
  node(around:${r},${latNum},${lngNum})[amenity=cafe];
  way(around:${r},${latNum},${lngNum})[amenity=cafe];
  node(around:${r},${latNum},${lngNum})[amenity=restaurant];
  way(around:${r},${latNum},${lngNum})[amenity=restaurant];
  node(around:${r},${latNum},${lngNum})[amenity=fast_food];
  way(around:${r},${latNum},${lngNum})[amenity=fast_food];
  node(around:${r},${latNum},${lngNum})[shop];
  way(around:${r},${latNum},${lngNum})[shop];
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
    const cat = e.tags?.leisure || e.tags?.tourism || e.tags?.amenity || e.tags?.shop || 'place';
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
 * Google Text Search query tuned from the user's message. It includes both
 * public/civic rows and query-relevant commercial POIs so Gemini can answer
 * dynamic asks like "quiet affordable cafe near me" from location data.
 */
export function buildGooglePlacesConciergeQuery(userMessage) {
  const t = String(userMessage || '').toLowerCase();
  const parts = [
    'nearby places points of interest cafes restaurants shops parks attractions',
    'cafes coffee shops bakeries restaurants food dining',
    'parks public gardens plazas playgrounds outdoor recreation walking paths',
    'libraries museums galleries monuments memorials community centers theatres',
    'local shops markets bookstores salons gyms pharmacies'
  ];
  if (/\b(cafe|cafes|café|coffee|espresso|latte|chai|tea|bakery)\b/.test(t)) parts.push('cafe coffee shop tea bakery');
  if (/\b(quiet|study|laptop|work|peaceful|calm)\b/.test(t)) parts.push('quiet cafe study coffee shop peaceful');
  if (/\b(affordable|cheap|budget|under|below|price)\b/.test(t)) parts.push('affordable cafes cheap eats budget restaurants');
  if (/\b(food|restaurant|lunch|dinner|breakfast|brunch|snack|meal|hungry)\b/.test(t)) parts.push('restaurants food dining snacks');
  if (/\b(shop|shopping|store|gift|bookstore|books|clothes|fashion|market)\b/.test(t)) parts.push('shops stores markets bookstores gifts');
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
  const maxResults = Math.min(120, Math.max(8, Number(opts.maxResults) || 20));
  const detailsCap = Math.min(16, Math.max(0, Number(opts.detailsCap) || 0));
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return [];

  const merged = new Map();
  const add = (p) => {
    if (!p?.name || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
    const k = `${String(p.name).toLowerCase()}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
    if (!merged.has(k)) merged.set(k, p);
  };

  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const queries = buildGooglePlacesSearchTerms(userMessage);
      for (const searchTerm of queries) {
        const batch = await fetchGooglePlacesTextOnce({
          searchTerm,
          latNum,
          lngNum,
          radiusMeters
        });
        batch.forEach(add);
        // Small gap to reduce 429 risk while still enriching Google coverage.
        await delay(120);
      }
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

  let rows = Array.from(merged.values())
    .map((p) => ({
      ...p,
      distanceMeters: haversineMeters(latNum, lngNum, p.lat, p.lng)
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, maxResults);

  if (process.env.GOOGLE_MAPS_API_KEY && detailsCap > 0) {
    const enriched = [];
    for (const row of rows.slice(0, detailsCap)) {
      if (row.source === 'google_places' && row.id) {
        try {
          const detail = await fetchGooglePlaceDetails(row.id);
          if (detail && Number.isFinite(Number(detail.lat)) && Number.isFinite(Number(detail.lng))) {
            enriched.push({
              ...row,
              ...detail,
              distanceMeters: haversineMeters(latNum, lngNum, Number(detail.lat), Number(detail.lng))
            });
            await delay(80);
            continue;
          }
        } catch (e) {
          console.warn('[publicPlaces] Google details', e?.message || e);
        }
      }
      enriched.push(row);
    }
    rows = [...enriched, ...rows.slice(detailsCap)]
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, maxResults);
  }

  return rows;
}
