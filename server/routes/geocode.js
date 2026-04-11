import express from 'express';

const router = express.Router();
const DEFAULT_CENTER = { lat: 28.6139, lng: 77.2090 };
const MAP_PROVIDER_MODE = (process.env.MAP_PROVIDER_MODE || 'osm').toLowerCase();



const poiCache = new Map();
const POI_CACHE_TTL_MS = 2 * 60 * 1000;

function cacheKey(latNum, lngNum, term, r) {

  const la = latNum.toFixed(3);
  const lo = lngNum.toFixed(3);
  const rr = Math.round(Number(r) || 0);
  return `${la}|${lo}|${term.toLowerCase()}|${rr}`;
}

function getCached(key) {
  const entry = poiCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    poiCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  poiCache.set(key, { value, expiresAt: Date.now() + POI_CACHE_TTL_MS });
}

const CATEGORY_SYNONYMS = {
  hospital: ['hospital', 'clinic', 'doctor', 'medical', 'healthcare', 'pharmacy'],
  clinic: ['clinic', 'doctor', 'hospital', 'medical'],
  mall: ['mall', 'shopping', 'supermarket', 'department_store'],
  park: ['park', 'garden', 'playground'],
  hotel: ['hotel', 'resort', 'hostel', 'guest_house'],
  restaurant: ['restaurant', 'food', 'cafe', 'fast_food']
};

const OVERPASS_CATEGORY_TAGS = {
  hospital: ['amenity=hospital', 'amenity=clinic', 'amenity=doctors', 'amenity=pharmacy'],
  clinic: ['amenity=clinic', 'amenity=doctors'],
  restaurant: ['amenity=restaurant', 'amenity=fast_food', 'amenity=cafe', 'amenity=food_court'],
  cafe: ['amenity=cafe'],
  mall: ['shop=mall', 'shop=supermarket', 'shop=department_store'],
  hotel: ['tourism=hotel', 'tourism=hostel', 'tourism=guest_house'],
  park: ['leisure=park', 'leisure=garden', 'leisure=playground']
};

function getSearchTerms(term) {
  const base = (term || '').toLowerCase().trim();
  if (!base) return [];
  const out = [base];
  Object.entries(CATEGORY_SYNONYMS).forEach(([k, list]) => {
    if (base.includes(k)) list.forEach((v) => out.push(v));
  });
  return Array.from(new Set(out)).slice(0, 8);
}

function getCategoryTagFilters(term) {
  const base = (term || '').toLowerCase().trim();
  const tags = [];
  Object.entries(OVERPASS_CATEGORY_TAGS).forEach(([k, list]) => {
    if (base.includes(k)) tags.push(...list);
  });
  return Array.from(new Set(tags)).slice(0, 10);
}

function haversineMeters(la1, lo1, la2, lo2) {
  const R = 6371e3;
  const phi1 = la1 * Math.PI / 180;
  const phi2 = la2 * Math.PI / 180;
  const dPhi = (la2 - la1) * Math.PI / 180;
  const dLambda = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function tokenize(value) {
  return String(value || '').
  toLowerCase().
  replace(/[^a-z0-9\s]/g, ' ').
  split(/\s+/).
  filter((t) => t.length >= 2);
}

function getGoogleRelevanceScore(query, place) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 0;
  const queryTokens = tokenize(q);
  if (!queryTokens.length) return 0;

  const name = String(place?.name || '').toLowerCase();
  const category = String(place?.category || '').toLowerCase();
  const haystack = `${name} ${category}`;
  const placeTokens = new Set(tokenize(haystack));

  let score = 0;
  if (name === q) score += 12;
  if (name.startsWith(q)) score += 8;
  if (name.includes(q)) score += 6;
  if (category.includes(q)) score += 4;

  queryTokens.forEach((qt) => {
    if (placeTokens.has(qt)) score += 3;else
    if (Array.from(placeTokens).some((pt) => pt.startsWith(qt) || qt.startsWith(pt))) score += 1;
  });

  return score;
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(t);
  }
}

async function fetchWithRetryOn429(url, opts, timeoutMs, maxAttempts = 2) {

  let lastResp = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastResp = await fetchWithTimeout(url, opts, timeoutMs);
    if (lastResp.ok) return lastResp;
    if (lastResp.status !== 429) return lastResp;
    const backoffMs = 700 * (attempt + 1);

    await new Promise((r) => setTimeout(r, backoffMs));
  }
  return lastResp;
}

async function fetchGooglePlacesText({
  searchTerm,
  latNum,
  lngNum,
  radiusMeters
}) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!apiKey || !searchTerm) return [];

  const resp = await fetchWithTimeout(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
        'places.id,places.displayName,places.location,places.primaryType,places.formattedAddress'
      },
      body: JSON.stringify({
        textQuery: searchTerm,
        maxResultCount: 20,
        languageCode: 'en',
        locationBias: {
          circle: {
            center: { latitude: latNum, longitude: lngNum },
            radius: Math.min(Math.max(radiusMeters, 500), 50000)
          }
        }
      })
    },
    9000
  );

  if (!resp.ok) return [];
  const data = await resp.json();
  const places = Array.isArray(data?.places) ? data.places : [];
  return places.
  map((p) => {
    const la = Number(p?.location?.latitude);
    const lo = Number(p?.location?.longitude);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    return {
      id: p.id || `${la},${lo}`,
      name: p.displayName?.text || p.formattedAddress || 'Unnamed place',
      category: p.primaryType || 'place',
      lat: la,
      lng: lo
    };
  }).
  filter(Boolean);
}

router.get('/ip-location', async (req, res) => {
  try {
    const resp = await fetch('https://ip-api.com/json/?fields=lat,lon,status');
    const data = await resp.json();
    if (data.status === 'success') {
      return res.json({ lat: data.lat, lng: data.lon });
    }
  } catch (e) {}
  res.json(DEFAULT_CENTER);
});

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.status(400).json({ error: 'Query required' });
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`
    );
    const data = await resp.json();
    if (data?.[0]) {
      return res.json({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
    }
  } catch (e) {}
  res.status(404).json({ error: 'Location not found' });
});


router.get('/poi', async (req, res) => {
  try {
    const { lat, lng, q, radius = 2000 } = req.query;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }
    const term = (q || '').toString().trim();
    const r = Math.min(Math.max(Number(radius) || 2000, 200), 30000);

    const safeTerm = term.replace(/"/g, '');
    const relatedTerms = getSearchTerms(safeTerm);
    const categoryTagFilters = getCategoryTagFilters(safeTerm);

    const key = cacheKey(latNum, lngNum, safeTerm || '', r);
    const cached = getCached(key);
    if (cached) return res.json(cached);


    if (safeTerm && (MAP_PROVIDER_MODE === 'google' || MAP_PROVIDER_MODE === 'hybrid')) {
      try {
        const googlePlaces = await fetchGooglePlacesText({
          searchTerm: safeTerm,
          latNum,
          lngNum,
          radiusMeters: r
        });

        const strictlyRelated = googlePlaces.
        map((p) => ({
          ...p,
          relevanceScore: getGoogleRelevanceScore(safeTerm, p),
          distanceMeters: haversineMeters(latNum, lngNum, p.lat, p.lng)
        })).
        filter((p) => p.relevanceScore >= 3).
        sort((a, b) => {
          if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
          return a.distanceMeters - b.distanceMeters;
        }).
        slice(0, 80);

        if (strictlyRelated.length > 0) {
          setCached(key, strictlyRelated);
          return res.json(strictlyRelated);
        }


        if (MAP_PROVIDER_MODE === 'google') {
          return res.json([]);
        }
      } catch (e) {
        if (MAP_PROVIDER_MODE === 'google') {
          return res.json([]);
        }
      }
    }


    const overpassRegexTerm = safeTerm.

    replace(/[\\\[\]\(\)\.\^\$\|\?\*\+\{\}]/g, (m) => `\\${m}`).

    replace(/\s+/g, '.*');
    const delta = Math.max(0.03, Math.min(r / 111000, 0.25));
    const left = (lngNum - delta).toFixed(6);
    const right = (lngNum + delta).toFixed(6);
    const top = (latNum + delta).toFixed(6);
    const bottom = (latNum - delta).toFixed(6);

    const merged = new Map();
    const addPlace = (p) => {
      if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
      const key = `${(p.name || '').toLowerCase()}|${p.lat.toFixed(5)}|${p.lng.toFixed(5)}`;
      if (!merged.has(key)) merged.set(key, p);
    };

    if (safeTerm) {
      for (const searchTerm of relatedTerms) {
        try {
          const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
            searchTerm
          )}&limit=80&addressdetails=0&namedetails=0&bounded=1&viewbox=${left},${top},${right},${bottom}`;

          const nominatimResp = await fetchWithRetryOn429(
            nominatimUrl,
            { headers: { 'User-Agent': 'GoOut/1.0 (Local Development)' } },
            8000,
            3
          );
          if (!nominatimResp.ok) continue;

          const nomData = await nominatimResp.json();
          const arr = Array.isArray(nomData) ? nomData : [];
          arr.forEach((item) => {
            const la = parseFloat(item.lat);
            const lo = parseFloat(item.lon);
            if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
            addPlace({
              id: item.place_id || `${item.lat},${item.lon}`,
              name: item.display_name?.split(',')?.[0] || item.name || 'Unnamed place',
              category: item.type || item.class || 'place',
              lat: la,
              lng: lo
            });
          });
        } catch (e) {

        }
      }
    }

    const categorySpecificFilters = categoryTagFilters.
    map(
      (tag) => `
        node(around:${r},${latNum},${lngNum})[${tag}];
        way(around:${r},${latNum},${lngNum})[${tag}];
        relation(around:${r},${latNum},${lngNum})[${tag}];
      `
    ).
    join('\n');

    const filters = safeTerm ?
    `
        node(around:${r},${latNum},${lngNum})[name~"${overpassRegexTerm}",i];
        way(around:${r},${latNum},${lngNum})[name~"${overpassRegexTerm}",i];
        relation(around:${r},${latNum},${lngNum})[name~"${overpassRegexTerm}",i];
        node(around:${r},${latNum},${lngNum})[amenity~"${overpassRegexTerm}",i];
        way(around:${r},${latNum},${lngNum})[amenity~"${overpassRegexTerm}",i];
        relation(around:${r},${latNum},${lngNum})[amenity~"${overpassRegexTerm}",i];
        node(around:${r},${latNum},${lngNum})[shop~"${overpassRegexTerm}",i];
        way(around:${r},${latNum},${lngNum})[shop~"${overpassRegexTerm}",i];
        relation(around:${r},${latNum},${lngNum})[shop~"${overpassRegexTerm}",i];
        node(around:${r},${latNum},${lngNum})[leisure~"${overpassRegexTerm}",i];
        way(around:${r},${latNum},${lngNum})[leisure~"${overpassRegexTerm}",i];
        relation(around:${r},${latNum},${lngNum})[leisure~"${overpassRegexTerm}",i];
        node(around:${r},${latNum},${lngNum})[tourism~"${overpassRegexTerm}",i];
        way(around:${r},${latNum},${lngNum})[tourism~"${overpassRegexTerm}",i];
        relation(around:${r},${latNum},${lngNum})[tourism~"${overpassRegexTerm}",i];
        ${categorySpecificFilters}
      ` :
    `
        node(around:${r},${latNum},${lngNum})[amenity];
        way(around:${r},${latNum},${lngNum})[amenity];
        relation(around:${r},${latNum},${lngNum})[amenity];
        node(around:${r},${latNum},${lngNum})[leisure];
        way(around:${r},${latNum},${lngNum})[leisure];
        relation(around:${r},${latNum},${lngNum})[leisure];
        node(around:${r},${latNum},${lngNum})[tourism];
        way(around:${r},${latNum},${lngNum})[tourism];
        relation(around:${r},${latNum},${lngNum})[tourism];
      `;

    try {
      const overpassQuery = `[out:json][timeout:10];(${filters});out center tags;`;
      const overpassResp = await fetchWithTimeout(
        'https://overpass-api.de/api/interpreter',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: overpassQuery }).toString()
        },
        9000
      );

      if (overpassResp.ok) {
        const overpassData = await overpassResp.json();
        const elements = Array.isArray(overpassData.elements) ? overpassData.elements : [];
        elements.forEach((e) => {
          const latVal = typeof e.lat === 'number' ? e.lat : e.center?.lat;
          const lngVal = typeof e.lon === 'number' ? e.lon : e.center?.lon;
          if (typeof latVal !== 'number' || typeof lngVal !== 'number') return;
          addPlace({
            id: e.id,
            name: e.tags?.name || 'Unnamed place',
            category: e.tags?.amenity || e.tags?.shop || e.tags?.leisure || e.tags?.tourism || 'place',
            lat: latVal,
            lng: lngVal
          });
        });
      }
    } catch (e) {

    }

    const getFiltered = () => {
      const withDistance = Array.from(merged.values()).map((p) => ({
        ...p,
        distanceMeters: haversineMeters(latNum, lngNum, p.lat, p.lng)
      }));
      const filtered = withDistance.filter((p) => p.distanceMeters <= r * 1.15);
      filtered.sort((a, b) => a.distanceMeters - b.distanceMeters);
      return filtered;
    };

    if (safeTerm && (MAP_PROVIDER_MODE === 'google' || MAP_PROVIDER_MODE === 'hybrid')) {
      try {
        const googlePlaces = await fetchGooglePlacesText({
          searchTerm: safeTerm,
          latNum,
          lngNum,
          radiusMeters: r
        });
        googlePlaces.forEach((p) => addPlace(p));
      } catch (e) {

      }
    }

    let filtered = getFiltered();
    if (safeTerm && filtered.length < 8) {

      for (const searchTerm of relatedTerms) {
        const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
          searchTerm
        )}&limit=100&addressdetails=0&namedetails=0`;

        const fallbackResp = await fetchWithRetryOn429(
          fallbackUrl,
          { headers: { 'User-Agent': 'GoOut/1.0 (Local Development)' } },
          8000,
          3
        );
        if (!fallbackResp.ok) continue;

        const fallbackData = await fallbackResp.json();
        const fallbackArr = Array.isArray(fallbackData) ? fallbackData : [];
        fallbackArr.forEach((item) => {
          const la = parseFloat(item.lat);
          const lo = parseFloat(item.lon);
          if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
          addPlace({
            id: item.place_id || `${la},${lo}`,
            name: item.display_name?.split(',')?.[0] || item.name || 'Unnamed place',
            category: item.type || item.class || 'place',
            lat: la,
            lng: lo
          });
        });
      }
    }
    filtered = getFiltered();


    if (safeTerm) {
      const interim = getFiltered();
      if (interim.filter((p) => p.distanceMeters <= r * 1.15).length < 12) {
        try {
          const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
            safeTerm
          )}&lat=${latNum}&lon=${lngNum}&limit=80`;
          const photonResp = await fetchWithTimeout(photonUrl, { method: 'GET' }, 8000);
          if (photonResp.ok) {
            const photonData = await photonResp.json();
            const features = Array.isArray(photonData?.features) ? photonData.features : [];
            features.forEach((f) => {
              const coords = f?.geometry?.coordinates;
              if (!Array.isArray(coords) || coords.length < 2) return;
              const lo = Number(coords[0]);
              const la = Number(coords[1]);
              if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
              const p = f.properties || {};
              addPlace({
                id: f.id || `${la},${lo}`,
                name: p.name || p.street || p.city || p.state || 'Unnamed place',
                category: p.osm_value || p.type || 'place',
                lat: la,
                lng: lo
              });
            });
          }
        } catch (e) {

        }
      }
    }
    filtered = getFiltered();



    if (safeTerm && filtered.length === 0) {
      const genericOverpass = `[out:json][timeout:10];
        (
          node(around:${r},${latNum},${lngNum})[amenity];
          way(around:${r},${latNum},${lngNum})[amenity];
          node(around:${r},${latNum},${lngNum})[leisure];
          way(around:${r},${latNum},${lngNum})[leisure];
          node(around:${r},${latNum},${lngNum})[tourism];
          way(around:${r},${latNum},${lngNum})[tourism];
        );
        out center tags;`;

      try {
        const genericResp = await fetchWithTimeout(
          'https://overpass-api.de/api/interpreter',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ data: genericOverpass }).toString()
          },
          9000
        );

        if (genericResp.ok) {
          const genericData = await genericResp.json();
          const elements = Array.isArray(genericData.elements) ? genericData.elements : [];
          const places = elements.
          map((e) => {
            const latVal = typeof e.lat === 'number' ? e.lat : e.center?.lat;
            const lngVal = typeof e.lon === 'number' ? e.lon : e.center?.lon;
            if (typeof latVal !== 'number' || typeof lngVal !== 'number') return null;
            return {
              id: e.id,
              name: e.tags?.name || 'Unnamed place',
              category: e.tags?.amenity || e.tags?.leisure || e.tags?.tourism || 'place',
              lat: latVal,
              lng: lngVal,
              distanceMeters: haversineMeters(latNum, lngNum, latVal, lngVal)
            };
          }).
          filter(Boolean).
          filter((p) => p.distanceMeters <= r * 1.15).
          sort((a, b) => a.distanceMeters - b.distanceMeters);

          if (places.length > 0) {
            const out = places.slice(0, 160);
            setCached(key, out);
            return res.json(out);
          }
        }
      } catch (e) {

      }
    }
    const out = filtered.slice(0, 220);
    if (out.length > 0) setCached(key, out);
    res.json(out);
  } catch (e) {
    console.error('POI search error', e);
    res.json([]);
  }
});

export default router;