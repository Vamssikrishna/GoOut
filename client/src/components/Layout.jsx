import { Outlet, NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

function navPillClass({ isActive }) {
  return `goout-nav-pill ${isActive ? 'goout-nav-pill-active' : ''}`;
}

export default function Layout() {
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

    const socket = io(window.location.origin, { auth: { token } });
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

  return (
    <div className="goout-page-shell goout-app-mesh relative min-h-screen">
      <header className="goout-header-hud sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4 motion-safe:goout-animate-in">
        <div className="mx-auto w-full max-w-[1240px]">
          <div className="goout-dock w-full rounded-2xl sm:rounded-[1.35rem] shadow-dock">
            <div className="flex flex-wrap justify-between items-center min-h-[4.25rem] gap-2 sm:gap-4 px-2.5 sm:px-5 lg:px-6 py-2">
              <NavLink
                to="/app"
                className="goout-brand-link font-display text-xl font-bold tracking-tight sm:text-2xl">
                GoOut
              </NavLink>
              <nav className="goout-nav-cluster flex items-center gap-1 sm:gap-2 flex-wrap justify-end rounded-xl border border-slate-200 bg-slate-50 px-1.5 py-1 sm:rounded-2xl max-w-full">
                {user?.role !== 'merchant' &&
                <>
                    <NavLink to="/app" end className={navPillClass}>Explore</NavLink>
                    <NavLink to="/app/buddies" className={navPillClass}>Buddies</NavLink>
                  </>
                }
                {user?.role === 'merchant' &&
                <NavLink to="/app/merchant" className={navPillClass}>Merchant</NavLink>
                }
                <NavLink to="/app/profile" className={navPillClass}>Profile</NavLink>
                <button
                  type="button"
                  onClick={() => setDarkMode((v) => !v)}
                  className="goout-btn-ghost px-3 py-1.5 text-xs sm:text-sm min-w-[4.5rem]"
                  aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}>
                  {darkMode ? 'Light' : 'Dark'}
                </button>
                <div className="pl-1 sm:pl-2 flex items-center border-l border-slate-200 ml-0.5 sm:ml-1">
                  <button
                    type="button"
                    onClick={() => {
                      addToast({ type: 'info', title: 'Logged out', message: 'See you soon.' });
                      logout();
                    }}
                    className="goout-logout-btn rounded-lg px-3 py-2 text-sm font-semibold text-slate-600">
                    Log out
                  </button>
                </div>
              </nav>
            </div>
          </div>
        </div>
      </header>
      <main className="relative z-10 w-full px-4 py-8 sm:px-6 lg:px-8 goout-grid-overlay motion-safe:goout-animate-in">
        <div className="mx-auto w-full max-w-[1240px]">
          {/* No key={pathname} here — that remounted the entire outlet and destroyed the map on every nav. */}
          <Outlet />
        </div>
      </main>
    </div>);

}
