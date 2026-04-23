import express from 'express';
import { buildGreenRouteBundle } from '../services/greenRoutesService.js';

const router = express.Router();

async function fetchWithTimeout(url, opts, timeoutMs = 9000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(t);
  }
}



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

function getGoogleMode(profile) {
  const p = String(profile || '').toLowerCase();
  if (p === 'walking') return 'walking';
  if (p === 'driving') return 'driving';
  if (p === 'cycling') return 'bicycling';

  return 'driving';
}

function stripHtml(text) {
  return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isLikelyHighwayStep(step) {
  const txt = stripHtml(step?.html_instructions || '');
  const maneuver = String(step?.maneuver || '').toLowerCase();
  const blob = `${txt} ${maneuver}`;
  return (
    /\b(highway|expressway|freeway|motorway|toll road|interstate|nh\s*\d+|sh\s*\d+|ring road)\b/.test(blob) ||
    /\bmerge\b/.test(maneuver)
  );
}

function mapGoogleRouteOut(route, { localPreferred = false } = {}) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const distanceMeters = legs.length ?
    legs.reduce((sum, leg) => sum + (leg?.distance?.value || 0), 0) :
    route?.legs?.[0]?.distance?.value || 0;
  const durationSeconds = legs.length ?
    legs.reduce((sum, leg) => sum + (leg?.duration?.value || 0), 0) :
    route?.legs?.[0]?.duration?.value || 0;

  const allSteps = legs.flatMap((leg) => (Array.isArray(leg?.steps) ? leg.steps : []));
  const totalSteps = allSteps.length || 1;
  const highwayStepCount = allSteps.reduce((n, s) => n + (isLikelyHighwayStep(s) ? 1 : 0), 0);
  const highwayShare = highwayStepCount / totalSteps;
  const usesHighway = highwayStepCount > 0;
  const poly = route?.overview_polyline?.points;
  const decoded = decodePolyline(poly);

  return {
    distanceMeters: Number(distanceMeters) || 0,
    durationSeconds: Number(durationSeconds) || 0,
    geometryLatLng: decoded.map((p) => [p.lat, p.lng]),
    localPreferred: Boolean(localPreferred),
    usesHighway,
    highwayShare
  };
}

function dedupeRoutes(routes) {
  const seen = new Set();
  return (Array.isArray(routes) ? routes : []).filter((r) => {
    const dist = Math.round(Number(r?.distanceMeters) || 0);
    const dur = Math.round(Number(r?.durationSeconds) || 0);
    const first = Array.isArray(r?.geometryLatLng) && r.geometryLatLng[0] ? r.geometryLatLng[0] : [];
    const key = `${dist}|${dur}|${Number(first[0] || 0).toFixed(4)}|${Number(first[1] || 0).toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchGoogleDirectionsRoutes({
  oLat,
  oLng,
  dLat,
  dLng,
  googleKey,
  mode,
  alternatives = true,
  avoidHighways = false
}) {
  const avoid = avoidHighways ? '&avoid=highways|tolls' : '';
  const url =
    `https://maps.googleapis.com/maps/api/directions/json?` +
    `origin=${encodeURIComponent(`${oLat},${oLng}`)}` +
    `&destination=${encodeURIComponent(`${dLat},${dLng}`)}` +
    `&mode=${encodeURIComponent(mode)}` +
    `&alternatives=${alternatives ? 'true' : 'false'}` +
    `${avoid}` +
    `&key=${encodeURIComponent(googleKey)}`;
  const resp = await fetchWithTimeout(url, { method: 'GET' }, 15000);
  if (!resp.ok) return [];
  const data = await resp.json();
  if ((data?.status || '').toString() !== 'OK') return [];
  return Array.isArray(data?.routes) ? data.routes : [];
}

function isLocalishRoute(route) {
  const h = Number(route?.highwayShare);
  if (Number.isFinite(h)) return h <= 0.22;
  if (route?.usesHighway === false) return true;
  return Boolean(route?.localPreferred);
}

function rankRoutesLocalFirst(routes, limit) {
  const sorted = dedupeRoutes(routes).sort((a, b) => {
    const aLocal = isLocalishRoute(a) ? 1 : 0;
    const bLocal = isLocalishRoute(b) ? 1 : 0;
    if (aLocal !== bLocal) return bLocal - aLocal;
    const ah = Number(a.highwayShare ?? (a.usesHighway ? 1 : 0));
    const bh = Number(b.highwayShare ?? (b.usesHighway ? 1 : 0));
    if (ah !== bh) return ah - bh;
    return (a.durationSeconds || 0) - (b.durationSeconds || 0);
  });

  const local = sorted.filter((r) => isLocalishRoute(r));
  const fallback = sorted.filter((r) => !isLocalishRoute(r));
  const cap = Math.max(1, Number(limit) || 4);
  if (local.length >= cap) return local.slice(0, cap);
  return [...local, ...fallback].slice(0, cap);
}

async function fetchOsrmRoutes({
  coords,
  osrmProfile,
  alternatives = true,
  excludeMotorway = false,
  localPreferred = false
}) {
  const base = `https://router.project-osrm.org/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&alternatives=${alternatives ? 'true' : 'false'}&steps=false&annotations=distance,duration`;
  const url = excludeMotorway && osrmProfile === 'driving' ? `${base}&exclude=motorway` : base;
  const resp = await fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': 'GoOut/1.0 (Local Development)' } }, 10000);
  if (!resp.ok) return [];
  const data = await resp.json();
  const routes = Array.isArray(data?.routes) ? data.routes : [];
  return routes.map((r) => ({
    distanceMeters: Number(r.distance) || 0,
    durationSeconds: Number(r.duration) || 0,
    geometryLatLng: (r.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    localPreferred: Boolean(localPreferred),
    usesHighway: null,
    highwayShare: null
  }));
}

router.post('/route', async (req, res) => {
  try {
    const { origin, destination, profile = 'driving', alternatives = true, maxAlternatives = 4 } = req.body || {};

    const oLat = origin?.lat != null ? Number(origin.lat) : NaN;
    const oLng = origin?.lng != null ? Number(origin.lng) : NaN;
    const dLat = destination?.lat != null ? Number(destination.lat) : NaN;
    const dLng = destination?.lng != null ? Number(destination.lng) : NaN;

    if (![oLat, oLng, dLat, dLng].every((n) => Number.isFinite(n))) {
      return res.status(400).json({ error: 'origin and destination lat/lng are required' });
    }

    const osrmProfile =
    profile === 'walking' ? 'foot' : profile === 'cycling' ? 'bike' : profile === 'driving' ? 'driving' : 'driving';


    const googleKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (googleKey) {
      try {
        const googleMode = getGoogleMode(profile);
        const preferLocalDriving = googleMode === 'driving';
        const [localRaw, regularRaw] = preferLocalDriving ?
          await Promise.all([
            fetchGoogleDirectionsRoutes({
              oLat,
              oLng,
              dLat,
              dLng,
              googleKey,
              mode: googleMode,
              alternatives,
              avoidHighways: true
            }),
            fetchGoogleDirectionsRoutes({
              oLat,
              oLng,
              dLat,
              dLng,
              googleKey,
              mode: googleMode,
              alternatives,
              avoidHighways: false
            })
          ]) :
          [await fetchGoogleDirectionsRoutes({
            oLat,
            oLng,
            dLat,
            dLng,
            googleKey,
            mode: googleMode,
            alternatives,
            avoidHighways: false
          }), []];

        const mappedLocal = (localRaw || []).map((r) => mapGoogleRouteOut(r, { localPreferred: true }));
        const mappedRegular = (regularRaw || []).map((r) => mapGoogleRouteOut(r, { localPreferred: false }));
        const outRoutes = rankRoutesLocalFirst([...mappedLocal, ...mappedRegular], Math.max(1, Number(maxAlternatives) || 4));

        if (outRoutes.length > 0) return res.json({ routes: outRoutes });
      } catch (e) {

      }
    }

    const coords = `${oLng},${oLat};${dLng},${dLat}`;
    const preferLocalDriving = osrmProfile === 'driving';
    const [localOsrm, regularOsrm] = preferLocalDriving ?
      await Promise.all([
        fetchOsrmRoutes({
          coords,
          osrmProfile,
          alternatives,
          excludeMotorway: true,
          localPreferred: true
        }),
        fetchOsrmRoutes({
          coords,
          osrmProfile,
          alternatives,
          excludeMotorway: false,
          localPreferred: false
        })
      ]) :
      [await fetchOsrmRoutes({
        coords,
        osrmProfile,
        alternatives,
        excludeMotorway: false,
        localPreferred: false
      }), []];
    const outRoutesRaw = dedupeRoutes([...(localOsrm || []), ...(regularOsrm || [])]);
    if (!outRoutesRaw.length) {
      return res.status(502).json({ error: 'Directions provider error', status: 502 });
    }
    const outRoutes = rankRoutesLocalFirst(outRoutesRaw, Math.max(1, Number(maxAlternatives) || 4));

    return res.json({ routes: outRoutes });
  } catch (e) {
    console.error('Directions error', e);
    return res.status(500).json({ error: 'Directions failed' });
  }
});

router.post('/green-bundle', async (req, res) => {
  try {
    const { origin, destination, destinationName } = req.body || {};
    const oLat = origin?.lat != null ? Number(origin.lat) : NaN;
    const oLng = origin?.lng != null ? Number(origin.lng) : NaN;
    const dLat = destination?.lat != null ? Number(destination.lat) : NaN;
    const dLng = destination?.lng != null ? Number(destination.lng) : NaN;
    if (![oLat, oLng, dLat, dLng].every((n) => Number.isFinite(n))) {
      return res.status(400).json({ error: 'origin and destination lat/lng are required' });
    }
    const googleKey = process.env.GOOGLE_MAPS_API_KEY || '';
    const bundle = await buildGreenRouteBundle(
      { lat: oLat, lng: oLng },
      { lat: dLat, lng: dLng },
      { destinationName: String(destinationName || 'destination').slice(0, 120), googleKey }
    );
    res.json(bundle);
  } catch (e) {
    console.error('Green bundle error', e);
    return res.status(500).json({ error: 'Green routing failed' });
  }
});

export default router;