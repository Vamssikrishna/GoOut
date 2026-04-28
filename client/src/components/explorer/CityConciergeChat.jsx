import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import api, { getAssetUrl } from '../../api/client';

function formatDist(m) {
  if (m == null || !Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatLocalLocation(place) {
  const address = String(place?.address || '').trim();
  if (address) return address;
  const coords = place?.location?.coordinates || [];
  const lng = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
  return 'Location not available';
}

function formatPublicLocation(place) {
  const address = String(place?.address || '').trim();
  if (address) return address;
  const lat = Number(place?.lat);
  const lng = Number(place?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return 'Location not available';
}

/** Slim payload so the concierge prompt matches pins on the Explorer map. */
function buildWelcomeContent(displayName) {
  const first =
    typeof displayName === 'string' && displayName.trim() ?
      displayName.trim().split(/\s+/)[0] :
      '';
  const hi = first ? `Hi ${first}! ` : 'Hi! ';
  return `${hi}What's near? I use your pin, budget, vibe. Merchants, parks, deals. Logged in? Try: save preference prefer: quiet cafes`;
}

function buildMapContextPayload(mc) {
  if (!mc || typeof mc !== 'object') return undefined;
  const slimMenuItems = (items) =>
    (Array.isArray(items) ? items : [])
      .map((item) => ({
        name: String(item?.name || '').trim().slice(0, 90),
        price: Number(item?.price),
        description: String(item?.description || '').trim().slice(0, 140)
      }))
      .filter((item) => item.name && Number.isFinite(item.price) && item.price >= 0)
      .slice(0, 12);
  const slimBiz = (b) => ({
    _id: b._id,
    name: b.name,
    category: b.category,
    tags: Array.isArray(b.tags) ? b.tags.slice(0, 12) : [],
    greenInitiatives: Array.isArray(b.greenInitiatives) ? b.greenInitiatives.slice(0, 8) : [],
    avgPrice: b.avgPrice,
    isFree: b.isFree,
    rating: b.rating,
    crowdLevel: b.crowdLevel,
    localVerification: b.localVerification
      ? { redPin: Boolean(b.localVerification.redPin), status: b.localVerification.status }
      : undefined,
    location: b.location,
    address: typeof b.address === 'string' ? b.address.slice(0, 160) : b.address,
    description: typeof b.description === 'string' ? b.description.slice(0, 200) : undefined,
    distanceMeters: typeof b.distance === 'number' ? b.distance : b.distanceMeters,
    openingHours: b.openingHours,
    menuItems: slimMenuItems(b.menuItems),
    menuCatalogText: typeof b.menuCatalogText === 'string' ? b.menuCatalogText.replace(/\s+/g, ' ').trim().slice(0, 900) : undefined,
    menuCatalogFileUrl: typeof b.menuCatalogFileUrl === 'string' ? b.menuCatalogFileUrl : undefined,
    ecoOptions: b.ecoOptions,
    localKarmaScore: b.localKarmaScore,
    carbonWalkIncentive: b.carbonWalkIncentive,
    distance: b.distance
  });
  const slimPoi = (p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    distanceMeters: p.distanceMeters,
    address: p.address,
    rating: p.rating,
    source: p.source,
    placeId: p.placeId || p.place_id
  });
  const slimOffer = (o) => ({
    _id: o._id,
    title: o.title,
    offerPrice: o.offerPrice,
    validUntil: o.validUntil,
    businessId: o.businessId,
    createdAt: o.createdAt,
    isActive: o.isActive
  });
  return {
    businesses: (mc.businesses || []).map(slimBiz),
    pois: (mc.pois || []).map(slimPoi),
    offers: (mc.offers || []).map(slimOffer)
  };
}

function MapPinGoIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s-7-4.35-7-11a7 7 0 1 1 14 0c0 6.65-7 11-7 11z" />
      <circle cx="12" cy="10" r="2" fill="white" fillOpacity="0.95" stroke="white" strokeWidth="1" />
    </svg>
  );
}

function ChatBubbleIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5c-4.9 0-8.9 3.4-8.9 7.7 0 2.5 1.3 4.7 3.4 6.1l-.9 3.3 3.5-1.6c.9.2 1.9.4 2.9.4 4.9 0 8.9-3.4 8.9-7.7S16.9 3.5 12 3.5z" />
      <circle cx="9.1" cy="11.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.9" cy="11.2" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9.2 14.7c.8.6 1.7.9 2.8.9s2.1-.3 2.8-.9" />
    </svg>
  );
}

function CloseIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function PlaceRows({ items, kind, onPickPlace, onGoRoute }) {
  if (!items?.length) {
    return <p className="text-xs text-slate-500 py-1">No {kind} results for this search.</p>;
  }
  return (
    <ul className="mt-1 max-h-44 overflow-y-auto rounded-xl border border-slate-200/90 bg-slate-50/80 divide-y divide-slate-200/80 shadow-inner">
      {items.map((p) => (
        <li key={`${kind}-${p.id}`} className="group/row flex items-stretch gap-0 bg-white hover:bg-gradient-to-r hover:from-white hover:to-goout-mint/30 transition-colors duration-200">
          <button
            type="button"
            onClick={() => onPickPlace(p, kind)}
            className="flex-1 min-w-0 text-left px-2.5 py-2.5 text-xs flex flex-col gap-0.5"
          >
            {kind === 'local' ? (
              <>
                <span className="font-medium text-slate-900 truncate">Title: {p.name}</span>
                <span className="text-slate-600 truncate">Category: {p.category || 'N/A'}</span>
                <span className="text-slate-600">
                  Average Price: {p.avgPrice != null ? `₹${p.avgPrice}` : 'N/A'}
                </span>
                <span className="text-slate-600 truncate">Location: {formatLocalLocation(p)}</span>
                {p.menuCatalogFileUrl ? (
                  <a
                    href={getAssetUrl(p.menuCatalogFileUrl)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-emerald-700 font-medium underline w-fit"
                  >
                    View menu
                  </a>
                ) : (
                  <span className="text-slate-500">View menu: Not available</span>
                )}
              </>
            ) : (
              <>
                <span className="font-medium text-slate-900 truncate">Name: {p.name}</span>
                <span className="text-slate-600 truncate">Category: {p.category || 'N/A'}</span>
                <span className="text-slate-600">
                  Stars: {Number.isFinite(Number(p.rating)) ? Number(p.rating).toFixed(1) : 'N/A'}
                </span>
                <span className="text-slate-600 truncate">Location: {formatPublicLocation(p)}</span>
              </>
            )}
          </button>
          <div className="flex items-center pr-1.5 py-1.5">
            <button
              type="button"
              onClick={() => (onGoRoute ? onGoRoute(p, kind) : onPickPlace(p, kind))}
              title={onGoRoute ? 'Walking route from you' : 'Show on map'}
              aria-label={onGoRoute ? `Walking route from you to ${p.name}` : `Show ${p.name} on the map`}
              className="group/go relative flex flex-col items-center justify-center gap-0.5 min-w-[3.25rem] rounded-xl px-2 py-2
                bg-gradient-to-br from-goout-accent via-goout-green to-emerald-700
                text-white font-display font-bold text-[10px] uppercase tracking-widest
                shadow-md shadow-goout-green/40 ring-1 ring-white/25
                hover:shadow-lg hover:shadow-goout-green/50 hover:ring-white/40 hover:-translate-y-px
                active:translate-y-0 active:shadow-md active:scale-[0.97]
                transition-all duration-200 ease-out
                focus:outline-none focus-visible:ring-2 focus-visible:ring-goout-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              <span className="absolute inset-0 rounded-xl bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover/go:opacity-100 transition-opacity pointer-events-none" />
              <MapPinGoIcon className="relative w-4 h-4 drop-shadow-sm group-hover/go:scale-110 transition-transform duration-200" />
              <span className="relative leading-none">Go</span>
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function CityConciergeChat({
  userLocation,
  /** Signed-in user's name (from profile); concierge uses it server-side too when authenticated. */
  userDisplayName,
  /** Explorer map search radius in meters — keeps AI merchant/public fetch aligned with the map. */
  explorationRadiusM,
  greenMode = false,
  /** Current Explorer map pins: { businesses, pois, offers } */
  mapContext,
  onMapPan,
  onHighlightBusiness,
  /** (place, kind) => void — draw route from user to place on Explorer map */
  onGoRoute,
  /** When concierge detects zero-spend intent, sync Explorer map budget overlay */
  onDiscoveryBudgetHint,
  className = ''
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => [
    {
      id: 'welcome',
      role: 'assistant',
      content: buildWelcomeContent(userDisplayName)
    }
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** message id -> 'local' | 'public' when user picked a filter after disambiguation */
  const [listTabByMsgId, setListTabByMsgId] = useState({});
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, loading]);

  useEffect(() => {
    const content = buildWelcomeContent(userDisplayName);
    setMessages((prev) => {
      if (prev.length === 1 && prev[0]?.id === 'welcome' && prev[0]?.role === 'assistant') {
        return [{ ...prev[0], content }];
      }
      return prev;
    });
  }, [userDisplayName]);

  const pickPlace = useCallback(
    (place, kind) => {
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
      onMapPan?.({ lat: place.lat, lng: place.lng });
      if (kind === 'local' && place.id) {
        onHighlightBusiness?.(String(place.id));
      } else {
        onHighlightBusiness?.(null);
      }
    },
    [onMapPan, onHighlightBusiness]
  );

  const goRouteFromRow = useCallback(
    (place, kind) => {
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
      if (onGoRoute) {
        onGoRoute({
          lat: place.lat,
          lng: place.lng,
          label: String(place.name || '').trim(),
          kind,
          id: place.id != null ? String(place.id) : undefined
        });
      } else {
        pickPlace(place, kind);
      }
    },
    [onGoRoute, pickPlace]
  );

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!userLocation || !Number.isFinite(userLocation.lat) || !Number.isFinite(userLocation.lng)) {
      setError('Location is required for the concierge.');
      return;
    }

    setError('');
    setInput('');

    const priorHistory = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map(({ role, content }) => ({ role, content: String(content || '') }))
      .filter((m) => m.content.trim())
      .slice(-14);

    const userMsg = {
      id: globalThis.crypto?.randomUUID?.() ?? `u-${Date.now()}`,
      role: 'user',
      content: text
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const mapPayload = buildMapContextPayload(mapContext);
      const { data } = await api.post('/concierge/chat', {
        message: text,
        lat: userLocation.lat,
        lng: userLocation.lng,
        history: priorHistory,
        greenMode,
        ...(Number.isFinite(Number(explorationRadiusM)) && Number(explorationRadiusM) >= 200 ?
          { explorationRadiusM: Number(explorationRadiusM) } :
          {}),
        ...(mapPayload ? { mapContext: mapPayload } : {})
      });

      let assistantText = data.reply || '';
      if (data.carbonCreditsNudge) {
        assistantText = `${assistantText}\n\n${data.carbonCreditsNudge}`;
      }

      const assistantMsg = {
        id: globalThis.crypto?.randomUUID?.() ?? `a-${Date.now()}`,
        role: 'assistant',
        content: assistantText,
        browseIntent: data.meta?.browseIntent || 'none',
        nearby: data.nearby || { local: [], public: [], mapPois: [] }
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Do not auto-pan map from AI response.
      // Map should move only when user explicitly interacts (Go / row click).

      onHighlightBusiness?.(data.highlightBusinessId ? String(data.highlightBusinessId) : null);

      if (data.meta?.isZeroSpend) {
        onDiscoveryBudgetHint?.({ isZeroSpend: true });
      }
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Request failed';
      setMessages((prev) => [
        ...prev,
        {
          id: globalThis.crypto?.randomUUID?.() ?? `e-${Date.now()}`,
          role: 'assistant',
          content: `Sorry — ${msg}`,
          browseIntent: 'none',
          nearby: { local: [], public: [], mapPois: [] }
        }
      ]);
      onHighlightBusiness?.(null);
    } finally {
      setLoading(false);
    }
  };

  const setListTab = (msgId, tab) => {
    setListTabByMsgId((s) => ({ ...s, [msgId]: tab }));
  };

  const renderAssistantExtras = (m) => {
    const intent = m.browseIntent || 'none';
    const nearby = m.nearby || { local: [], public: [], mapPois: [] };
    const nLocal = nearby.local?.length || 0;
    const publicCombined = [...(nearby.public || []), ...(nearby.mapPois || [])];
    const nPublic = publicCombined.length;
    const tab = listTabByMsgId[m.id];

    if (intent === 'none' || m.role !== 'assistant') return null;

    if (intent === 'both' && (nLocal > 0 || nPublic > 0)) {
      return (
        <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
          {nLocal > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-goout-dark uppercase tracking-wide">Local (GoOut)</p>
              <PlaceRows items={nearby.local} kind="local" onPickPlace={pickPlace} onGoRoute={goRouteFromRow} />
            </div>
          )}
          {nPublic > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-goout-dark uppercase tracking-wide">Public & map search</p>
              <PlaceRows items={publicCombined} kind="public" onPickPlace={pickPlace} onGoRoute={goRouteFromRow} />
            </div>
          )}
        </div>
      );
    }

    if (intent === 'local' && nLocal > 0) {
      return (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <p className="text-[11px] font-semibold text-goout-dark uppercase tracking-wide">Nearby local</p>
          <PlaceRows items={nearby.local} kind="local" onPickPlace={pickPlace} onGoRoute={goRouteFromRow} />
        </div>
      );
    }

    if (intent === 'public' && nPublic > 0) {
      return (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <p className="text-[11px] font-semibold text-goout-dark uppercase tracking-wide">Public & map search</p>
          <PlaceRows items={publicCombined} kind="public" onPickPlace={pickPlace} onGoRoute={goRouteFromRow} />
        </div>
      );
    }

    if (intent === 'disambiguate' && (nLocal > 0 || nPublic > 0)) {
      return (
        <div className="mt-2 border-t border-slate-200 pt-2 space-y-2">
          <p className="text-xs text-slate-600">Browse by source:</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={nLocal === 0}
              onClick={() => setListTab(m.id, 'local')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                tab === 'local' ? 'bg-goout-green text-white border-goout-green' : 'bg-white text-slate-800 border-slate-200 hover:border-goout-green'
              } ${nLocal === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              Local · {nLocal}
            </button>
            <button
              type="button"
              disabled={nPublic === 0}
              onClick={() => setListTab(m.id, 'public')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                tab === 'public' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-800 border-slate-200 hover:border-slate-400'
              } ${nPublic === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              Public · {nPublic}
            </button>
          </div>
          {tab === 'local' && <PlaceRows items={nearby.local} kind="local" onPickPlace={pickPlace} onGoRoute={goRouteFromRow} />}
          {tab === 'public' && <PlaceRows items={publicCombined} kind="public" onPickPlace={pickPlace} onGoRoute={goRouteFromRow} />}
        </div>
      );
    }

    return null;
  };

  /** Portal to body so position:fixed is viewport-relative (Layout route animation uses transform, which traps fixed descendants). */
  const panelTransition =
    'transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.34,1.2,0.64,1)] motion-reduce:transition-none motion-reduce:duration-0';

  return createPortal(
    <div
      className={`pointer-events-none fixed z-[10050] bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-[max(1rem,env(safe-area-inset-right,0px))] sm:bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:right-[max(1.5rem,env(safe-area-inset-right,0px))] ${className}`}>
      <div className="relative flex flex-col items-end">
        <div
          className={`
            absolute bottom-full right-0 mb-2 w-[min(100vw-2rem,420px)] max-h-[min(78vh,560px)] flex flex-col rounded-[1.35rem] border border-orange-200 bg-white shadow-2xl shadow-orange-950/15 overflow-hidden origin-bottom-right
            ${panelTransition}
            ${open ?
              'z-[10051] translate-y-0 scale-100 opacity-100 pointer-events-auto' :
              'z-0 translate-y-3 scale-[0.96] opacity-0 pointer-events-none'}
          `}
          style={{ willChange: open ? 'opacity, transform' : 'auto' }}
          aria-hidden={!open}
          inert={!open ? '' : undefined}
        >
          <div className="px-4 py-3 border-b border-orange-100 bg-gradient-to-r from-orange-50 via-white to-emerald-50 flex items-center justify-between gap-2">
            <div>
              <p className="font-display font-semibold text-slate-900 text-sm">City Concierge</p>
              <p className="text-[11px] text-slate-600">GoOut local + public spots near you</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-slate-800 p-1 rounded-lg hover:bg-white text-lg leading-none transition-colors duration-200"
              aria-label="Close concierge"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm bg-gradient-to-b from-white via-orange-50/25 to-emerald-50/25">
            {messages.map((m, i) => (
              <div
                key={m.id || `${i}`}
                className={`max-w-[96%] px-3 py-2.5 rounded-2xl shadow-sm backdrop-blur-[1px] transition-all duration-200 ${
                  m.role === 'user' ?
                    'ml-auto border border-orange-400/25 bg-gradient-to-br from-orange-500 via-rose-500 to-emerald-600 text-white shadow-orange-500/25' :
                    'mr-auto border border-slate-200/90 bg-white/95 text-slate-800'
                }`}
              >
                <div className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  m.role === 'user' ? 'text-emerald-100/90' : 'text-emerald-700'
                }`}>
                  {m.role === 'user' ? 'You' : 'Concierge'}
                </div>
                <div className={`whitespace-pre-wrap text-sm leading-relaxed ${
                  m.role === 'user' ? 'text-white/95' : 'text-slate-700'
                }`}>
                  {m.content}
                </div>
                {m.role === 'assistant' && renderAssistantExtras(m)}
              </div>
            ))}
            {loading && (
              <div className="mr-auto w-fit rounded-2xl border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-slate-800 text-sm shadow-sm animate-pulse">
                Concierge is thinking...
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {error && <p className="px-3 text-xs text-red-600">{error}</p>}
          <div className={`p-2 border-t border-orange-100 flex gap-2 bg-white ${loading ? 'goout-ai-thinking' : ''}`}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Near me? Café + park"
              disabled={loading}
              className="goout-input flex-1 min-w-0 text-sm"
            />
            <button
              type="button"
              onClick={send}
              disabled={loading || !input.trim()}
              className="goout-btn-primary text-sm disabled:opacity-50 shrink-0"
            >
              Send
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="pointer-events-auto group relative z-[10052] h-14 w-14 rounded-full bg-gradient-to-br from-orange-500 via-rose-500 to-emerald-500 text-white shadow-[0_12px_28px_rgba(249,115,22,0.38)] border-2 border-white/95 flex items-center justify-center font-display font-bold text-lg hover:shadow-[0_16px_34px_rgba(249,115,22,0.48)] hover:scale-105 active:scale-95 transition-all duration-300 ease-out motion-reduce:transition-none motion-reduce:hover:scale-100"
          aria-expanded={open}
          aria-label={open ? 'Close concierge chat' : 'Open city concierge chat'}
        >
          {!open && (
            <>
              <span className="pointer-events-none absolute inset-0 rounded-full bg-white/12" />
              <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-lime-300 ring-2 ring-white/90 shadow-sm" />
            </>
          )}
          {open ? (
            <CloseIcon className="h-5 w-5 transition-transform duration-200 ease-out" />
          ) : (
            <ChatBubbleIcon className="h-6 w-6 transition-transform duration-200 ease-out group-hover:scale-110 group-hover:-translate-y-0.5" />
          )}
        </button>
      </div>
    </div>,
    document.body
  );
}
