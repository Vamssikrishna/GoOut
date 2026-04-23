import express from 'express';

const router = express.Router();
const DEFAULT_CENTER = { lat: 28.6139, lng: 77.2090 };
const MAP_PROVIDER_MODE = (process.env.MAP_PROVIDER_MODE || 'hybrid').toLowerCase();
const FAST_POI_RESPONSE_BUDGET_MS = 5500;
const MAX_PARALLEL_SEARCH_TERMS = 4;



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



const OVERPASS_CATEGORY_TAGS = {
  hospital: ['amenity=hospital', 'amenity=clinic', 'amenity=doctors', 'amenity=pharmacy'],
  clinic: ['amenity=clinic', 'amenity=doctors'],
  restaurant: ['amenity=restaurant', 'amenity=fast_food', 'amenity=cafe', 'amenity=food_court'],
  cafe: ['amenity=cafe'],
  mall: ['shop=mall', 'shop=supermarket', 'shop=department_store'],
  hotel: ['tourism=hotel', 'tourism=hostel', 'tourism=guest_house'],
  park: ['leisure=park', 'leisure=garden', 'leisure=playground'],
  theatre: ['amenity=theatre', 'amenity=cinema', 'building=theatre'],
  theater: ['amenity=theatre', 'amenity=cinema', 'building=theatre'],
  cinema: ['amenity=cinema', 'amenity=theatre'],
  movie: ['amenity=cinema', 'amenity=theatre']
};

function getSearchTerms(term) {
  const base = (term || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!base) return [];
  const terms = new Set([base]);
  const withoutCityTail = base.replace(/\s+\bin\s+[a-z0-9\s-]{2,}$/i, '').trim();
  if (withoutCityTail && withoutCityTail !== base) {
    terms.add(withoutCityTail);
  }
  if (/\b(theatre|theater|cinema|movie|film|imax)\b/.test(base)) {
    terms.add('movie theater');
    terms.add('cinema');
    terms.add('performing arts theater');
    terms.add('theatre');
    terms.add('theater');
  }
  if (/\b(park|garden|playground|outdoor)\b/.test(base)) {
    terms.add('public park');
    terms.add('botanical garden');
  }
  return Array.from(terms).slice(0, 6);
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
        maxResultCount: 15,
        languageCode: 'en',
        locationBias: {
          circle: {
            center: { latitude: latNum, longitude: lngNum },
            radius: Math.min(Math.max(radiusMeters, 500), 50000)
          }
        }
      })
    },
    4500
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

async function fetchGooglePlacesTextBatch({
  searchTerms,
  latNum,
  lngNum,
  radiusMeters,
  maxResults = 120
}) {
  const merged = new Map();
  const list = Array.isArray(searchTerms) ? searchTerms.filter(Boolean).slice(0, MAX_PARALLEL_SEARCH_TERMS) : [];
  const settled = await Promise.allSettled(
    list.map((term) => fetchGooglePlacesText({ searchTerm: term, latNum, lngNum, radiusMeters }))
  );
  settled.forEach((entry) => {
    const rows = entry.status === 'fulfilled' && Array.isArray(entry.value) ? entry.value : [];
    rows.forEach((p) => {
      const k = `${String(p.name || '').toLowerCase().slice(0, 64)}|${Number(p.lat).toFixed(5)}|${Number(p.lng).toFixed(5)}`;
      if (!merged.has(k)) merged.set(k, p);
    });
  });
  return Array.from(merged.values()).slice(0, maxResults);
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
    const query = String(q || '').trim();
    if (!query) return res.status(400).json({ error: 'Query required' });

    const zoomFromRadius = (radiusMeters) => {
      const r = Number(radiusMeters) || 0;
      if (r >= 180000) return 6;
      if (r >= 120000) return 7;
      if (r >= 80000) return 8;
      if (r >= 45000) return 9;
      if (r >= 25000) return 10;
      if (r >= 12000) return 11;
      return 12;
    };

    const googleKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (googleKey) {
      try {
        const gResp = await fetchWithTimeout(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(googleKey)}`,
          { method: 'GET' },
          10000
        );
        if (gResp.ok) {
          const gData = await gResp.json();
          if (String(gData?.status || '') === 'OK' && Array.isArray(gData?.results) && gData.results.length > 0) {
            const cityLike = gData.results.find((r) =>
              Array.isArray(r?.types) && (
                r.types.includes('locality') ||
                r.types.includes('administrative_area_level_1') ||
                r.types.includes('administrative_area_level_2')
              )
            ) || gData.results[0];
            const lat = Number(cityLike?.geometry?.location?.lat);
            const lng = Number(cityLike?.geometry?.location?.lng);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              const neLat = Number(cityLike?.geometry?.viewport?.northeast?.lat);
              const neLng = Number(cityLike?.geometry?.viewport?.northeast?.lng);
              const swLat = Number(cityLike?.geometry?.viewport?.southwest?.lat);
              const swLng = Number(cityLike?.geometry?.viewport?.southwest?.lng);
              const hasViewport = [neLat, neLng, swLat, swLng].every((n) => Number.isFinite(n));
              const viewportRadius = hasViewport ?
                Math.max(
                  haversineMeters(lat, lng, neLat, neLng),
                  haversineMeters(lat, lng, swLat, swLng)
                ) :
                50000;
              const suggestedRadiusMeters = Math.max(12000, Math.min(220000, Math.round(viewportRadius)));
              const types = Array.isArray(cityLike?.types) ? cityLike.types : [];
              const scope = types.includes('administrative_area_level_1') ?
                'state' :
                types.includes('administrative_area_level_2') ?
                  'region' :
                  'city';
              const label =
                String(cityLike?.formatted_address || '').split(',')[0].trim() ||
                query;
              const countryComp = (Array.isArray(cityLike?.address_components) ? cityLike.address_components : [])
                .find((c) => Array.isArray(c?.types) && c.types.includes('country'));
              const countryCode = String(countryComp?.short_name || '').toUpperCase();
              return res.json({
                lat,
                lng,
                source: 'google_geocode',
                label,
                scope,
                countryCode,
                inIndia: countryCode === 'IN',
                suggestedRadiusMeters,
                suggestedZoom: zoomFromRadius(suggestedRadiusMeters)
              });
            }
          }
        }
      } catch {
        // fall through to OSM fallback
      }
    }

    const resp = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`,
      { method: 'GET', headers: { 'User-Agent': 'GoOut/1.0 (Local Development)' } },
      10000
    );
    if (!resp.ok) return res.status(502).json({ error: 'Geocode provider unavailable' });
    const data = await resp.json();
    const rows = Array.isArray(data) ? data : [];
    const cityLike =
      rows.find((r) => ['city', 'town', 'village', 'municipality', 'administrative'].includes(String(r?.type || '').toLowerCase())) ||
      rows[0];
    if (cityLike) {
      const lat = Number(cityLike.lat);
      const lng = Number(cityLike.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const bbox = Array.isArray(cityLike?.boundingbox) ? cityLike.boundingbox.map(Number) : [];
        const hasBbox = bbox.length >= 4 && bbox.every((n) => Number.isFinite(n));
        const [south, north, west, east] = hasBbox ? bbox : [NaN, NaN, NaN, NaN];
        const bboxRadius = hasBbox ?
          Math.max(
            haversineMeters(lat, lng, north, east),
            haversineMeters(lat, lng, south, west)
          ) :
          50000;
        const suggestedRadiusMeters = Math.max(12000, Math.min(220000, Math.round(bboxRadius)));
        const t = String(cityLike?.type || '').toLowerCase();
        const scope =
          t === 'administrative' ? 'state' :
            t === 'city' || t === 'town' || t === 'village' || t === 'municipality' ? 'city' :
              'region';
        return res.json({
          lat,
          lng,
          source: 'nominatim',
          label: String(cityLike?.display_name || query).split(',')[0].trim() || query,
          scope,
          countryCode: String(cityLike?.address?.country_code || '').toUpperCase(),
          inIndia: String(cityLike?.address?.country_code || '').toUpperCase() === 'IN',
          suggestedRadiusMeters,
          suggestedZoom: zoomFromRadius(suggestedRadiusMeters)
        });
      }
    }
  } catch (e) {}
  res.status(404).json({ error: 'Location not found' });
});


router.get('/reverse-city', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!apiKey) return res.status(500).json({ error: 'Google Maps API key missing' });
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

    const resp = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`);
    const data = await resp.json();
    if (data.status !== 'OK' || !data.results?.length) {
      return res.status(404).json({ error: 'City not found' });
    }

    let city = '';
    for (const comp of data.results[0].address_components) {
      if (comp.types.includes('locality')) {
        city = comp.long_name;
        break;
      }
    }
    if (!city) {
      for (const comp of data.results[0].address_components) {
        if (comp.types.includes('administrative_area_level_2')) {
          city = comp.long_name;
          break;
        }
      }
    }
    res.json({ city: city || 'Unknown City' });
  } catch (err) {
    console.error('Reverse Geocode Error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/poi', async (req, res) => {
  try {
    const startedAt = Date.now();
    const hasResponseBudget = () => Date.now() - startedAt <= FAST_POI_RESPONSE_BUDGET_MS;
    const { lat, lng, q, city, radius = 50000 } = req.query;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }
    
    let baseTerm = (q || '').toString().trim();
    let term = baseTerm;
    if (city && city.trim() !== '') {
      term = baseTerm ? `${baseTerm} in ${city}` : `places in ${city}`;
    }
    
    const r = Math.min(Math.max(Number(radius) || 50000, 200), 50000);

    const safeTerm = term.replace(/"/g, '');
    const relatedTerms = getSearchTerms(safeTerm).slice(0, MAX_PARALLEL_SEARCH_TERMS);
    const categoryTagFilters = getCategoryTagFilters(safeTerm);

    const key = cacheKey(latNum, lngNum, safeTerm || '', r);
    const cached = getCached(key);
    if (cached) return res.json(cached);


    if (safeTerm && (MAP_PROVIDER_MODE === 'google' || MAP_PROVIDER_MODE === 'hybrid')) {
      try {
        const googlePlaces = await fetchGooglePlacesTextBatch({
          searchTerms: relatedTerms,
          latNum,
          lngNum,
          radiusMeters: r,
          maxResults: 150
        });

        const strictlyRelated = googlePlaces.
        map((p) => ({
          ...p,
          distanceMeters: haversineMeters(latNum, lngNum, p.lat, p.lng)
        })).
        sort((a, b) => a.distanceMeters - b.distanceMeters).
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

    if (safeTerm && hasResponseBudget()) {
      const nominatimSettled = await Promise.allSettled(
        relatedTerms.map(async (searchTerm) => {
          const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
            searchTerm
          )}&limit=40&addressdetails=0&namedetails=0&bounded=1&viewbox=${left},${top},${right},${bottom}`;
          const nominatimResp = await fetchWithRetryOn429(
            nominatimUrl,
            { headers: { 'User-Agent': 'GoOut/1.0 (Local Development)' } },
            3200,
            2
          );
          if (!nominatimResp.ok) return [];
          const nomData = await nominatimResp.json();
          return Array.isArray(nomData) ? nomData : [];
        })
      );
      nominatimSettled.forEach((entry) => {
        if (entry.status !== 'fulfilled') return;
        entry.value.forEach((item) => {
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
      });
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
      const overpassQuery = `[out:json][timeout:7];(${filters});out center tags;`;
      const overpassResp = await fetchWithTimeout(
        'https://overpass-api.de/api/interpreter',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: overpassQuery }).toString()
        },
        4000
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

    let filtered = getFiltered();
    if (safeTerm && filtered.length < 8 && hasResponseBudget()) {
      const fallbackSettled = await Promise.allSettled(
        relatedTerms.map(async (searchTerm) => {
          const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
            searchTerm
          )}&limit=50&addressdetails=0&namedetails=0`;
          const fallbackResp = await fetchWithRetryOn429(
            fallbackUrl,
            { headers: { 'User-Agent': 'GoOut/1.0 (Local Development)' } },
            2800,
            2
          );
          if (!fallbackResp.ok) return [];
          const fallbackData = await fallbackResp.json();
          return Array.isArray(fallbackData) ? fallbackData : [];
        })
      );
      fallbackSettled.forEach((entry) => {
        if (entry.status !== 'fulfilled') return;
        entry.value.forEach((item) => {
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
      });
    }
    filtered = getFiltered();


    if (safeTerm && hasResponseBudget()) {
      const interim = getFiltered();
      if (interim.filter((p) => p.distanceMeters <= r * 1.15).length < 12) {
        try {
          const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
            safeTerm
          )}&lat=${latNum}&lon=${lngNum}&limit=80`;
          const photonResp = await fetchWithTimeout(photonUrl, { method: 'GET' }, 2500);
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



    if (safeTerm && filtered.length === 0 && hasResponseBudget()) {
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
          3500
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