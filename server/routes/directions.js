import express from 'express';

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

// Decode Google encoded polyline into an array of {lat, lng}.
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm
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

    const dLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dLat;

    shift = 0;
    result = 0;

    do {
      byte = points.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dLng = (result & 1) ? ~(result >> 1) : (result >> 1);
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
  // Default to driving to match your existing client behavior.
  return 'driving';
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

    // Preferred: Google Directions (when key is configured).
    const googleKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (googleKey) {
      try {
        const googleMode = getGoogleMode(profile);
        const url =
          `https://maps.googleapis.com/maps/api/directions/json?` +
          `origin=${encodeURIComponent(`${oLat},${oLng}`)}` +
          `&destination=${encodeURIComponent(`${dLat},${dLng}`)}` +
          `&mode=${encodeURIComponent(googleMode)}` +
          `&alternatives=${alternatives ? 'true' : 'false'}` +
          `&key=${encodeURIComponent(googleKey)}`;

        const resp = await fetchWithTimeout(url, { method: 'GET' }, 15000);
        if (resp.ok) {
          const data = await resp.json();
          const googleStatus = (data?.status || '').toString();
          const googleRoutes = Array.isArray(data?.routes) ? data.routes : [];

          if (googleStatus === 'OK' && googleRoutes.length > 0) {
            const outRoutes = googleRoutes
              .map((r) => {
                const distanceMeters = Array.isArray(r?.legs)
                  ? r.legs.reduce((sum, leg) => sum + (leg?.distance?.value || 0), 0)
                  : r?.legs?.[0]?.distance?.value || 0;
                const durationSeconds = Array.isArray(r?.legs)
                  ? r.legs.reduce((sum, leg) => sum + (leg?.duration?.value || 0), 0)
                  : r?.legs?.[0]?.duration?.value || 0;

                const poly = r?.overview_polyline?.points;
                const decoded = decodePolyline(poly);

                return {
                  distanceMeters: Number(distanceMeters) || 0,
                  durationSeconds: Number(durationSeconds) || 0,
                  // Client expects [lat, lng].
                  geometryLatLng: decoded.map((p) => [p.lat, p.lng]),
                };
              })
              .sort((a, b) => (a.durationSeconds || 0) - (b.durationSeconds || 0))
              .slice(0, Math.max(1, Number(maxAlternatives) || 4));

            if (outRoutes.length > 0) return res.json({ routes: outRoutes });
          }
        }
      } catch (e) {
        // Fall through to OSRM.
      }
    }

    const coords = `${oLng},${oLat};${dLng},${dLat}`;

    // OSRM public demo server supports alternatives=true.
    const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&alternatives=${alternatives ? 'true' : 'false'}&steps=false&annotations=distance,duration`;

    const resp = await fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': 'GoOut/1.0 (Local Development)' } }, 10000);
    if (!resp.ok) {
      return res.status(502).json({ error: 'Directions provider error', status: resp.status });
    }

    const data = await resp.json();
    const routes = Array.isArray(data?.routes) ? data.routes : [];

    // Sort by duration to keep "multi-routing" predictable.
    routes.sort((a, b) => (a.duration || 0) - (b.duration || 0));

    const outRoutes = routes.slice(0, Math.max(1, Number(maxAlternatives) || 4)).map((r) => ({
      distanceMeters: r.distance,
      durationSeconds: r.duration,
      geometryLatLng: (r.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    }));

    return res.json({ routes: outRoutes });
  } catch (e) {
    console.error('Directions error', e);
    return res.status(500).json({ error: 'Directions failed' });
  }
});

export default router;

