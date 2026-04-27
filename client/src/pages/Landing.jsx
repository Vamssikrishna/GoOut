import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';

const features = [
  {
    title: 'Discovery map',
    body: 'GPS-first search. Local pins, not endless lists.',
    accent: 'from-emerald-500/25 via-teal-500/15 to-slate-400/10',
    tag: 'Locate'
  },
  {
    title: 'Plans & buddies',
    body: 'Meetups, invites, routes—stay synced.',
    accent: 'from-emerald-500/20 via-slate-500/15 to-slate-400/10',
    tag: 'Gather'
  },
  {
    title: 'Deals & concierge',
    body: 'Flash deals + chat that fits your budget.',
    accent: 'from-slate-500/20 via-emerald-500/15 to-slate-400/10',
    tag: 'Save'
  }
];

const trust = ['Live GPS', 'Realtime', 'Merchant-ready'];
const DEFAULT_CENTER = { lat: 28.6139, lng: 77.2090 };
const GEO_OPTIONS = { enableHighAccuracy: true, maximumAge: 60000, timeout: 6500 };

function getNearbyMomentContext(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 11) {
    return {
      label: 'Morning rush',
      query: 'breakfast cafe',
      fallbackLines: ['Coffee spots wake up first', 'Quick walks beat traffic', 'Best time for low-crowd hangouts']
    };
  }
  if (hour >= 11 && hour < 16) {
    return {
      label: 'Lunch window',
      query: 'lunch restaurant',
      fallbackLines: ['Fresh offers usually drop now', 'Walkable lunches save commute time', 'Buddy groups are most active midday']
    };
  }
  if (hour >= 16 && hour < 21) {
    return {
      label: 'Evening peak',
      query: 'cafe park',
      fallbackLines: ['Post-work meetups trend nearby', 'Deals rotate faster in the evening', 'Parks and cafes fill up quickly']
    };
  }
  return {
    label: 'Late-night mode',
    query: 'tea cafe',
    fallbackLines: ['Late spots are fewer but closer', 'Best for quiet buddy routes', 'Shorter routes feel safer at night']
  };
}

export default function Landing() {
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [liveDealsCount, setLiveDealsCount] = useState(0);
  const [nearbyError, setNearbyError] = useState('');
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [locationSource, setLocationSource] = useState('default');

  const momentContext = useMemo(() => getNearbyMomentContext(new Date().getHours()), []);

  useEffect(() => {
    let mounted = true;

    const resolveLocation = async () => {
      if (navigator?.geolocation) {
        try {
          const coords = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve(pos.coords),
              (err) => reject(err),
              GEO_OPTIONS
            );
          });
          return { lat: Number(coords.latitude), lng: Number(coords.longitude), source: 'gps' };
        } catch {
          // Fall through to IP location.
        }
      }

      try {
        const { data } = await api.get('/geocode/ip-location');
        return { lat: Number(data?.lat), lng: Number(data?.lng), source: 'ip' };
      } catch {
        return { ...DEFAULT_CENTER, source: 'default' };
      }
    };

    const loadNearbyNow = async () => {
      setNearbyLoading(true);
      setNearbyError('');
      try {
        const location = await resolveLocation();
        const lat = Number(location?.lat);
        const lng = Number(location?.lng);
        const hasValidLocation = Number.isFinite(lat) && Number.isFinite(lng);
        const target = hasValidLocation ? { lat, lng } : DEFAULT_CENTER;

        const [poiRes, offersRes] = await Promise.all([
          api.get('/geocode/poi', {
            params: {
              lat: target.lat,
              lng: target.lng,
              q: momentContext.query,
              radius: 8000
            }
          }),
          api.get('/offers/live', {
            params: {
              lat: target.lat,
              lng: target.lng,
              maxDistance: 8000
            }
          })
        ]);

        if (!mounted) return;
        setLocationSource(hasValidLocation ? location.source : 'default');
        setNearbyPlaces(Array.isArray(poiRes?.data) ? poiRes.data.slice(0, 3) : []);
        setLiveDealsCount(Array.isArray(offersRes?.data) ? offersRes.data.length : 0);
        setLastRefreshAt(new Date());
      } catch {
        if (!mounted) return;
        setNearbyError('Live feed unavailable');
        setNearbyPlaces([]);
        setLiveDealsCount(0);
      } finally {
        if (mounted) setNearbyLoading(false);
      }
    };

    loadNearbyNow();
    return () => {
      mounted = false;
    };
  }, [momentContext.query]);

  const nearbyHeadline = nearbyLoading ?
    'Scanning your area for places and deals…' :
    nearbyError ?
      'Switching to vibe mode while live nearby data reconnects.' :
      `Now in ${momentContext.label.toLowerCase()}: live places and offers around you.`;

  const nearbyItems = nearbyPlaces.length > 0 ?
    nearbyPlaces.map((p) => {
      const name = String(p?.name || 'Local spot');
      const dist = Number(p?.distanceMeters);
      const distanceLabel = Number.isFinite(dist) ?
        (dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`) :
        'nearby';
      return `${name} · ${distanceLabel}`;
    }) :
    momentContext.fallbackLines;

  return (
    <div className="goout-app-mesh relative min-h-screen overflow-x-hidden font-display text-slate-900 goout-page-shell">
      <div className="goout-hero-orb w-[min(90vw,28rem)] h-[min(90vw,28rem)] -top-24 -left-24 bg-orange-300/35 animate-float-slow" />
      <div className="goout-hero-orb w-[min(70vw,22rem)] h-[min(70vw,22rem)] top-32 -right-16 bg-emerald-300/30 animate-float-delayed" />
      <div className="goout-hero-orb w-[min(50vw,16rem)] h-[min(50vw,16rem)] bottom-20 left-1/3 bg-rose-300/20 animate-pulse-soft" />

      <nav className="relative mx-auto w-full max-w-[1240px] flex justify-between items-center px-5 md:px-8 py-6 z-10 animate-fade-in">
        <span className="goout-brand-link text-2xl font-extrabold tracking-tight md:text-3xl">GoOut</span>
        <div className="flex gap-2 sm:gap-3">
          <Link
            to="/login"
            className="goout-link-landing border border-slate-200 bg-white text-slate-700 transition-shadow duration-300 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md">
            Login
          </Link>
          <Link
            to="/register"
            className="goout-link-landing bg-orange-500 text-white shadow-lg shadow-orange-500/25 transition-shadow duration-300 hover:bg-orange-600 hover:shadow-xl">
            Get started
          </Link>
        </div>
      </nav>

      <main className="relative z-10 mx-auto w-full max-w-[1240px] px-5 md:px-8 pb-28">
        <section className="pt-6 md:pt-14 lg:pt-20 lg:flex lg:items-end lg:justify-between gap-14">
          <div className="max-w-2xl goout-animate-stagger">
            <p className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-orange-700 shadow-sm">
              Hyper-local
              <span className="h-1 w-1 rounded-full bg-emerald-400" aria-hidden />
              Social
            </p>
            <h1 className="mt-5 text-4xl sm:text-5xl md:text-6xl lg:text-[4.25rem] font-extrabold leading-[1.02] tracking-tight text-slate-900">
              Discover local.
              <br />
              <span className="bg-gradient-to-r from-orange-500 via-rose-500 to-emerald-600 bg-clip-text text-transparent drop-shadow-sm">
                Explore together.
              </span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-xl">
              Find spots nearby. Meet people. Save more—where you actually are.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {trust.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                to="/register"
                className="goout-link-landing px-8 py-4 text-lg rounded-2xl bg-orange-500 text-white shadow-xl shadow-orange-500/30 hover:bg-orange-600 hover:shadow-2xl">
                Start exploring
              </Link>
              <Link
                to="/login"
                className="goout-link-landing px-8 py-4 text-lg rounded-2xl border-2 border-orange-200 bg-white text-slate-800 hover:border-orange-300 hover:bg-orange-50">
                Sign in
              </Link>
            </div>
          </div>
          <div className="hidden lg:block flex-1 max-w-md mb-2 animate-slide-up opacity-0 [animation-delay:200ms]">
            <div className="goout-glass-card goout-neon-panel rounded-[1.75rem] p-8 goout-hover-lift border border-slate-200 shadow-md">
              <div className="flex items-center justify-between gap-4 mb-6">
                <div className="h-2 w-28 rounded-full bg-gradient-to-r from-rose-400 to-orange-400" />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-rose-500/90">
                  Nearby now
                </span>
              </div>
              <p className="text-slate-500 text-sm leading-relaxed mb-5">
                {nearbyHeadline}
              </p>
              <div className="space-y-2.5 text-sm">
                {nearbyItems.map((item) => (
                  <div
                    key={item}
                    className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-slate-700">
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-8 grid grid-cols-3 gap-3 text-center">
                {[
                  { k: 'Nearby picks', v: nearbyLoading ? '...' : String(nearbyPlaces.length || 0) },
                  { k: 'Live deals', v: nearbyLoading ? '...' : String(liveDealsCount) },
                  {
                    k: 'Source',
                    v: locationSource === 'gps' ? 'GPS' : locationSource === 'ip' ? 'IP' : 'Default'
                  }
                ].map((cell) => (
                  <div
                    key={cell.k}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-3">
                    <div className="font-display text-lg font-bold text-slate-800">{cell.v}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{cell.k}</div>
                  </div>
                ))}
              </div>
              {lastRefreshAt && !nearbyLoading && !nearbyError && (
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Refreshed {lastRefreshAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="mt-16 md:mt-24">
          <div className="goout-glass-card goout-hover-lift rounded-3xl border border-slate-200 p-8 md:p-10 mb-8 md:mb-10 shadow-md">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
              <div className="max-w-xl">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-700 mb-2">How it works</p>
                <h2 className="font-display text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                  Built for walking, not scrolling.
                </h2>
                <p className="mt-3 text-slate-600 leading-relaxed">
                  Fast picks on a phone—sun or shade.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:gap-4 shrink-0 w-full max-w-md lg:max-w-sm">
                {[
                  { label: 'Rank', sub: 'Local-first' },
                  { label: 'Sync', sub: 'Realtime' },
                  { label: 'Trust', sub: 'Session-safe' }
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4 text-center">
                    <div className="font-display text-sm font-bold text-slate-900">{item.label}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mt-1">{item.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {features.map((f, i) => (
              <article
                key={f.title}
                className="goout-glass-card rounded-2xl p-6 md:p-7 goout-hover-lift group cursor-default border border-slate-200 animate-slide-up opacity-0"
                style={{ animationDelay: `${120 + i * 80}ms`, animationFillMode: 'forwards' }}>
                <div className="flex items-center justify-between gap-3 mb-5">
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    {f.tag}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">0{i + 1}</span>
                </div>
                <div
                  className={`h-1.5 w-12 rounded-full mb-5 bg-gradient-to-r ${f.accent} group-hover:w-24 transition-all duration-500 ease-out`}
                />
                <h3 className="font-bold text-lg mb-2 text-slate-900 group-hover:text-emerald-800 transition-colors">{f.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-20 md:mt-28 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200/60 pt-10 text-sm text-slate-500">
          <span className="font-display font-semibold text-slate-600">GoOut</span>
          <div className="flex flex-wrap justify-center gap-4">
            <Link to="/login" className="hover:text-emerald-600 transition-colors">
              Login
            </Link>
            <Link to="/register" className="hover:text-emerald-600 transition-colors">
              Register
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
