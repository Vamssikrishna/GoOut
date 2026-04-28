import { Outlet, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const SOCKET_URL = String(
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:5000' : window.location.origin)
).trim();

function navPillClass({ isActive }) {
  return `goout-nav-pill goout-nav-icon-pill ${isActive ? 'goout-nav-pill-active' : ''}`;
}

const EXPLORER_TABS = [
  { id: 'map', label: 'Map' },
  { id: 'budget', label: 'Budget' },
  { id: 'compare', label: 'Compare' },
  { id: 'green', label: 'Green' }
];

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z" />
      <path d="M9 3v15" />
      <path d="M15 6v15" />
    </svg>
  );
}

function BuddiesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function MerchantIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M3 9h18l-1-5H4L3 9z" />
      <path d="M5 9v11h14V9" />
      <path d="M9 20v-6h6v6" />
      <path d="M3 9a3 3 0 0 0 6 0" />
      <path d="M9 9a3 3 0 0 0 6 0" />
      <path d="M15 9a3 3 0 0 0 6 0" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function HeaderWalkAnimation() {
  return (
    <span className="goout-header-walk" aria-hidden>
      <span className="goout-header-home">
        <span className="goout-header-home-roof" />
        <span className="goout-header-home-body" />
      </span>
      <span className="goout-header-walk-track" />
      <span className="goout-header-shop">
        <span className="goout-header-shop-roof" />
        <span className="goout-header-shop-body" />
      </span>
      <span className="goout-header-person">
        <span className="goout-header-person-head" />
        <span className="goout-header-person-body" />
        <span className="goout-header-person-leg goout-header-person-leg--left" />
        <span className="goout-header-person-leg goout-header-person-leg--right" />
      </span>
    </span>
  );
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('goout_theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (darkMode) {
      root.classList.add('theme-dark');
      body.classList.add('theme-dark');
    } else {
      root.classList.remove('theme-dark');
      body.classList.remove('theme-dark');
    }
    try {
      localStorage.setItem('goout_theme', darkMode ? 'dark' : 'light');
    } catch {}
  }, [darkMode]);

  useEffect(() => {
    const token = localStorage.getItem('goout_token');
    if (!token) return undefined;

    const socket = io(SOCKET_URL, { auth: { token } });
    socket.on('buddy-meet-reminder', (payload) => {
      const activity = String(payload?.activity || 'Buddy meetup');
      const venue = String(payload?.venueName || '').trim();
      addToast({
        type: 'info',
        title: 'Meetup in 10 minutes',
        message: venue ? `${activity} at ${venue}` : activity,
        durationMs: 7000
      });
    });

    return () => socket.disconnect();
  }, [addToast]);

  const [cachedRoutes, setCachedRoutes] = useState([]);

  const openExplorerTab = (tabId) => {
    try {
      sessionStorage.setItem('goout_explorer_active_tab', tabId);
    } catch {}
    window.dispatchEvent(new CustomEvent('goout:explorer-tab', { detail: { tab: tabId } }));
    navigate('/app');
  };

  useEffect(() => {
    const key = location.pathname;
    if (!outlet) return;
    setCachedRoutes((prev) => {
      if (prev.some((r) => r.key === key)) return prev;
      const next = [...prev, { key, element: outlet }];
      // Keep cache bounded to avoid unbounded memory growth.
      return next.slice(-12);
    });
  }, [location.pathname, outlet]);

  return (
    <div className="goout-page-shell goout-app-mesh relative min-h-screen">
      <header className="goout-header-hud sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4 motion-safe:goout-animate-in">
        <div className="mx-auto w-full max-w-[1240px]">
          <div className="goout-dock w-full rounded-2xl sm:rounded-[1.35rem] shadow-dock">
            <div className="flex flex-wrap justify-between items-center min-h-[4.25rem] gap-2 sm:gap-4 px-2.5 sm:px-5 lg:px-6 py-2">
              <NavLink
                to="/app"
                className="goout-brand-shell">
                <span className="goout-brand-link font-display text-xl font-bold tracking-tight sm:text-2xl">GoOut</span>
              </NavLink>
              <HeaderWalkAnimation />
              <nav className="goout-nav-cluster flex items-center gap-1 sm:gap-2 flex-wrap justify-end rounded-xl border border-orange-100 bg-white px-1.5 py-1 sm:rounded-2xl max-w-full shadow-sm" aria-label="Primary app navigation">
                {user?.role !== 'merchant' &&
                <>
                    <div className="goout-explore-nav-wrap relative">
                      <NavLink to="/app" end className={navPillClass} aria-label="Explore" title="Explore">
                        <MapIcon />
                      </NavLink>
                      <div className="goout-explore-menu absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2">
                        <div className="flex items-center gap-3">
                        {EXPLORER_TABS.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => openExplorerTab(tab.id)}
                            className={`goout-explore-orb goout-explore-orb--${tab.id} flex h-16 w-16 flex-col items-center justify-center rounded-full border border-orange-100 bg-gradient-to-br from-white to-orange-50 text-[11px] font-bold text-slate-700 shadow-lg shadow-orange-950/10 transition hover:-translate-y-1 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 hover:shadow-xl hover:shadow-orange-500/15`}
                          >
                            <span className="text-sm">
                              {tab.id === 'map' ? '🗺' : tab.id === 'budget' ? '₹' : tab.id === 'compare' ? '⇄' : '🌿'}
                            </span>
                            <span>{tab.label}</span>
                          </button>
                        ))}
                        </div>
                      </div>
                    </div>
                    <NavLink to="/app/buddies" className={navPillClass} aria-label="Buddies" title="Buddies">
                      <BuddiesIcon />
                    </NavLink>
                  </>
                }
                {user?.role === 'merchant' &&
                <NavLink to="/app/merchant" className={navPillClass} aria-label="Merchant" title="Merchant">
                  <MerchantIcon />
                </NavLink>
                }
                <NavLink to="/app/profile" className={navPillClass} aria-label="Profile" title="Profile">
                  <ProfileIcon />
                </NavLink>
                <button
                  type="button"
                  onClick={() => setDarkMode((v) => !v)}
                  className="goout-theme-icon-btn"
                  aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                  title={darkMode ? 'Light mode' : 'Dark mode'}>
                  {darkMode ? <SunIcon /> : <MoonIcon />}
                </button>
                <div className="pl-1 sm:pl-2 flex items-center border-l border-slate-200 ml-0.5 sm:ml-1">
                  <button
                    type="button"
                    onClick={() => {
                      addToast({ type: 'info', title: 'Logged out', message: 'See you soon.' });
                      logout();
                    }}
                    className="goout-logout-btn goout-logout-icon-btn"
                    aria-label="Log out"
                    title="Log out">
                    <LogoutIcon />
                  </button>
                </div>
              </nav>
            </div>
          </div>
        </div>
      </header>
      <main className="relative z-10 w-full px-4 py-6 sm:py-8 sm:px-6 lg:px-8 goout-grid-overlay motion-safe:goout-animate-in pb-[max(2rem,env(safe-area-inset-bottom,0px))]">
        <div className="mx-auto w-full max-w-[1240px]">
          {cachedRoutes.map((route) =>
          <section
            key={route.key}
            className={route.key === location.pathname ? 'block' : 'hidden'}
            aria-hidden={route.key !== location.pathname}>
              {route.element}
            </section>
          )}
          {!cachedRoutes.length && <Outlet />}
        </div>
      </main>
    </div>);

}
