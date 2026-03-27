import { useEffect, useRef } from 'react';
import api from '../api/client';

const VISIT_RADIUS_M = 5;
const CHECK_INTERVAL_MS = 45000;
const COOLDOWN_MS = 2 * 60 * 60 * 1000;

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function useVisitMonitor(businesses, userLocation, isActive) {
  const lastRecordedRef = useRef({});
  const lastPosRef = useRef(null);
  const lastCheckRef = useRef(Date.now());
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!isActive || !userLocation || !businesses?.length) return;

    const checkAndRecord = (lat, lng) => {
      for (const b of businesses) {
        if (!b.location?.coordinates?.length) continue;
        const [blng, blat] = b.location.coordinates;
        const dist = getDistance(lat, lng, blat, blng);
        if (dist <= VISIT_RADIUS_M) {
          const key = b._id;
          const last = lastRecordedRef.current[key] || 0;
          if (Date.now() - last < COOLDOWN_MS) continue;
          const prev = lastPosRef.current;
          const distWalked = prev ? Math.round(getDistance(prev.lat, prev.lng, blat, blng)) : 0;
          const timeSec = Math.round((Date.now() - lastCheckRef.current) / 1000) || 45;
          lastPosRef.current = { lat, lng };
          lastCheckRef.current = Date.now();
          api.post('/visits/record', { lat, lng, businessId: b._id, distanceWalked: distWalked || Math.round(dist), timeSinceLastSec: timeSec })
            .then(() => {
              lastRecordedRef.current[key] = Date.now();
            })
            .catch(() => {});
          return;
        }
      }
      lastPosRef.current = { lat, lng };
    };

    const runCheck = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (p) => checkAndRecord(p.coords.latitude, p.coords.longitude),
        () => {}
      );
    };

    lastPosRef.current = userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null;
    runCheck();
    intervalRef.current = setInterval(runCheck, CHECK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, userLocation?.lat, userLocation?.lng, businesses]);
}
