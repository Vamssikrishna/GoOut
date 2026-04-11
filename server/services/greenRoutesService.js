/**
 * Eco route comparison vs a petrol-car baseline (order-of-magnitude, not regulatory reporting).
 * "Green path" heuristics use Google step text (parks, plazas, pedestrian wording) when available.
 */

const CAR_CO2_G_PER_KM = 192;
const TRANSIT_CO2_G_PER_KM = 72;
const CYCLE_CO2_G_PER_KM = 16;

function decodePolyline(points, precision = 5) {
  if (!points) return [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  const factor = 10 ** precision;
  while (index < points.length) {
    let shift = 0;
    let result = 0;
    let byte = null;
    do {
      byte = points.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;
    shift = 0;
    result = 0;
    do {
      byte = points.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;
    coordinates.push({ lat: lat / factor, lng: lng / factor });
  }
  return coordinates;
}

async function fetchWithTimeout(url, timeoutMs = 14000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const GREEN_STEP_RE =
  /\b(park|plaza|square|promenade|pedestrian|walkway|trail|garden|green|footpath|sidewalk|pavement|alley|boulevard|esplanade|riverside|canal)\b/i;

function greenStepsScoreFromRoute(route) {
  if (!route?.legs?.length) return 0;
  let hits = 0;
  for (const leg of route.legs) {
    const steps = leg.steps || [];
    for (const st of steps) {
      const txt = stripHtml(st.html_instructions || st.instructions || '');
      if (GREEN_STEP_RE.test(txt)) hits += 1;
    }
  }
  return Math.min(40, hits * 4);
}

function tripCo2Grams(mode, distanceMeters) {
  const km = (Number(distanceMeters) || 0) / 1000;
  if (mode === 'walking') return Math.round(km * 2);
  if (mode === 'cycling') return Math.round(km * CYCLE_CO2_G_PER_KM);
  if (mode === 'transit') return Math.round(km * TRANSIT_CO2_G_PER_KM);
  if (mode === 'driving') return Math.round(km * CAR_CO2_G_PER_KM);
  return Math.round(km * CAR_CO2_G_PER_KM);
}

function mapGoogleRouteToOut(route, mode) {
  const distanceMeters = Array.isArray(route?.legs) ?
    route.legs.reduce((s, leg) => s + (leg?.distance?.value || 0), 0) :
    route?.legs?.[0]?.distance?.value || 0;
  const durationSeconds = Array.isArray(route?.legs) ?
    route.legs.reduce((s, leg) => s + (leg?.duration?.value || 0), 0) :
    route?.legs?.[0]?.duration?.value || 0;
  const poly = route?.overview_polyline?.points;
  const decoded = decodePolyline(poly);
  const geometryLatLng = decoded.map((p) => [p.lat, p.lng]);
  const km = distanceMeters / 1000;
  const carBaseline = Math.round(km * CAR_CO2_G_PER_KM);
  const trip = tripCo2Grams(mode, distanceMeters);
  const co2SavedVsCarGrams = Math.max(0, carBaseline - trip);
  const greenPathScore = mode === 'walking' ? greenStepsScoreFromRoute(route) : mode === 'cycling' ? 12 : mode === 'transit' ? 8 : 0;
  const pleasantScore = co2SavedVsCarGrams * 0.08 + greenPathScore * 3 - Math.max(0, durationSeconds / 60 - 50) * 0.15;

  return {
    mode,
    distanceMeters: Number(distanceMeters) || 0,
    durationSeconds: Number(durationSeconds) || 0,
    geometryLatLng,
    co2GramsTrip: trip,
    co2SavedVsCarGrams,
    greenPathScore,
    pleasantScore: Math.round(pleasantScore * 10) / 10,
    carBaselineGrams: carBaseline
  };
}

async function googleDirections(origin, destination, mode, googleKey, { transitDeparture } = {}) {
  const oLat = origin.lat;
  const oLng = origin.lng;
  const dLat = destination.lat;
  const dLng = destination.lng;
  let url =
    `https://maps.googleapis.com/maps/api/directions/json?` +
    `origin=${encodeURIComponent(`${oLat},${oLng}`)}` +
    `&destination=${encodeURIComponent(`${dLat},${dLng}`)}` +
    `&mode=${encodeURIComponent(mode)}` +
    `&alternatives=false&key=${encodeURIComponent(googleKey)}`;
  if (mode === 'transit' && transitDeparture) {
    url += `&departure_time=${transitDeparture}`;
  }
  const resp = await fetchWithTimeout(url, 16000);
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.status !== 'OK' || !data.routes?.[0]) return null;
  return data.routes[0];
}

async function osrmRoute(origin, destination, profile) {
  const oLng = origin.lng;
  const oLat = origin.lat;
  const dLng = destination.lng;
  const dLat = destination.lat;
  const coords = `${oLng},${oLat};${dLng},${dLat}`;
  const p = profile === 'walking' ? 'foot' : profile === 'cycling' ? 'bike' : 'driving';
  const url = `https://router.project-osrm.org/route/v1/${p}/${coords}?overview=full&geometries=geojson&steps=false`;
  const resp = await fetchWithTimeout(url, 10000);
  if (!resp.ok) return null;
  const data = await resp.json();
  const r = data.routes?.[0];
  if (!r) return null;
  const geometryLatLng = (r.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]);
  return {
    distanceMeters: r.distance,
    durationSeconds: r.duration,
    geometryLatLng,
    legs: []
  };
}

/**
 * @returns {Promise<{ drivingBaseline: object|null, candidates: object[], recommended: object|null, microMobilityHint: string }>}
 */
export async function buildGreenRouteBundle(origin, destination, { destinationName = 'this place', googleKey = '' } = {}) {
  const candidates = [];
  let drivingBaseline = null;

  if (googleKey) {
    const dep = Math.floor(Date.now() / 1000);
    const [driveR, walkR, bikeR, transitR] = await Promise.all([
      googleDirections(origin, destination, 'driving', googleKey),
      googleDirections(origin, destination, 'walking', googleKey),
      googleDirections(origin, destination, 'bicycling', googleKey),
      googleDirections(origin, destination, 'transit', googleKey, { transitDeparture: dep })
    ]);
    if (driveR) {
      drivingBaseline = mapGoogleRouteToOut(driveR, 'driving');
    }
    if (walkR) candidates.push(mapGoogleRouteToOut(walkR, 'walking'));
    if (bikeR) candidates.push(mapGoogleRouteToOut(bikeR, 'cycling'));
    if (transitR) candidates.push(mapGoogleRouteToOut(transitR, 'transit'));
  } else {
    const [driveR, walkR, bikeR] = await Promise.all([
      osrmRoute(origin, destination, 'driving'),
      osrmRoute(origin, destination, 'walking'),
      osrmRoute(origin, destination, 'cycling')
    ]);
    if (driveR) drivingBaseline = mapGoogleRouteToOut({ ...driveR, legs: [] }, 'driving');
    if (walkR) candidates.push(mapGoogleRouteToOut({ ...walkR, legs: [] }, 'walking'));
    if (bikeR) candidates.push(mapGoogleRouteToOut({ ...bikeR, legs: [] }, 'cycling'));
  }

  if (!drivingBaseline && candidates.length) {
    const w = candidates.find((c) => c.mode === 'walking') || candidates[0];
    const km = w.distanceMeters / 1000;
    const carG = Math.round(km * CAR_CO2_G_PER_KM);
    drivingBaseline = {
      mode: 'driving',
      distanceMeters: w.distanceMeters,
      durationSeconds: Math.round(w.distanceMeters / 13.9),
      geometryLatLng: w.geometryLatLng,
      co2GramsTrip: carG,
      co2SavedVsCarGrams: 0,
      greenPathScore: 0,
      pleasantScore: 0,
      carBaselineGrams: carG
    };
  }

  const baselineMeters = drivingBaseline?.distanceMeters || 0;
  if (baselineMeters > 0) {
    const carGrams = Math.round((baselineMeters / 1000) * CAR_CO2_G_PER_KM);
    drivingBaseline.carBaselineGrams = carGrams;
    candidates.forEach((c) => {
      c.co2SavedVsCarGrams = Math.max(0, carGrams - c.co2GramsTrip);
      const durationMin = (c.durationSeconds || 0) / 60;
      c.pleasantScore =
        Math.round((c.co2SavedVsCarGrams * 0.08 + c.greenPathScore * 3 - Math.max(0, durationMin - 50) * 0.15) * 10) / 10;
    });
  }

  const walkish = candidates.filter((c) => c.mode === 'walking' || c.mode === 'cycling' || c.mode === 'transit');
  const pool = walkish.length ? walkish : candidates;
  pool.sort((a, b) => b.pleasantScore - a.pleasantScore);
  const recommended = pool[0] || null;

  const microMobilityHint =
    `Near ${destinationName}: look for municipal bike-share or e-scooter hubs within ~200m of Red Pin merchants — we don’t have live dock data here, but station maps are usually at the curb nearby.`;

  return {
    drivingBaseline,
    candidates,
    recommended,
    microMobilityHint,
    assumptionsNote: `Car baseline uses ~${CAR_CO2_G_PER_KM} g CO₂/km (petrol, indicative).`
  };
}
