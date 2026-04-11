import { useEffect, useMemo, useRef } from 'react';
import { GoogleMap, Marker, useLoadScript } from '@react-google-maps/api';

const DEFAULT_CENTER = { lat: 28.6139, lng: 77.2090 };

export default function ManualLocationPicker({ value, onPick, height = 260 }) {
  const center = useMemo(() => {
    if (value && Number.isFinite(value.lat) && Number.isFinite(value.lng)) return { lat: value.lat, lng: value.lng };
    return DEFAULT_CENTER;
  }, [value]);

  const markerPos = useMemo(() => {
    if (value && Number.isFinite(value.lat) && Number.isFinite(value.lng)) return { lat: value.lat, lng: value.lng };
    return null;
  }, [value]);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey || '',
    libraries: []
  });

  const mapRef = useRef(null);

  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;

    mapRef.current.panTo(center);
  }, [isLoaded, center]);

  if (!apiKey) {
    return (
      <div className="rounded-xl overflow-hidden border border-slate-200 bg-white p-4 text-sm text-slate-700">
        Google Maps API key is missing. Set `VITE_GOOGLE_MAPS_API_KEY` in `client/.env`.
      </div>);

  }

  if (loadError) {
    return (
      <div className="rounded-xl overflow-hidden border border-red-200 bg-white p-4 text-sm text-red-700">
        Failed to load Google Maps: {String(loadError.message || loadError)}
      </div>);

  }

  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
      <div className="h-[260px]" style={{ height }}>
        {!isLoaded ?
        <div className="h-full w-full flex items-center justify-center text-sm text-slate-600">Loading map...</div> :

        <GoogleMap
          onLoad={(map) => {
            mapRef.current = map;
          }}
          center={center}
          zoom={16}
          mapContainerStyle={{ width: '100%', height: '100%' }}
          options={{
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
            clickableIcons: false
          }}
          onClick={(e) => {
            if (!e?.latLng) return;
            const lat = e.latLng.lat();
            const lng = e.latLng.lng();
            onPick({ lat, lng });
          }}>
          
            {markerPos &&
          <Marker
            position={markerPos}
            icon={{
              path: window.google?.maps?.SymbolPath?.CIRCLE,
              fillColor: '#6b7280',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2,
              scale: 7
            }}
            draggable
            onDragEnd={(e) => {
              const ll = e?.latLng;
              if (!ll) return;
              onPick({ lat: ll.lat(), lng: ll.lng() });
            }} />

          }
          </GoogleMap>
        }
      </div>
      <div className="p-2 text-xs text-slate-600">Click on the map to set the exact pin (you can also drag the pin).</div>
    </div>);

}