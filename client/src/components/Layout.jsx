import { Outlet, NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
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

  return (
    <div className="goout-page-shell goout-app-mesh relative min-h-screen">
      <header className="goout-header-hud sticky top-0 z-40 border-b border-cyan-200/40 bg-white/45 backdrop-blur-xl shadow-lg shadow-cyan-500/5 motion-safe:goout-animate-in">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-[4.25rem] gap-4">
            <NavLink
              to="/app"
              className="goout-brand-link font-display text-xl font-bold tracking-tight sm:text-2xl">
              GoOut
            </NavLink>
            <nav className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end rounded-2xl border border-cyan-200/40 bg-white/35 px-2 py-1 backdrop-blur-md">
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
                className="goout-btn-ghost px-3 py-1.5 text-xs sm:text-sm">
                {darkMode ? 'Light' : 'Dark'}
              </button>
              <div className="pl-1 sm:pl-2 flex items-center border-l border-cyan-200/50 ml-0.5 sm:ml-1">
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
      </header>
      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 goout-grid-overlay motion-safe:goout-animate-in">
        {/* No key={pathname} here — that remounted the entire outlet and destroyed the map on every nav. */}
        <Outlet />
      </main>
    </div>);

}
