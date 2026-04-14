import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

function navPillClass({ isActive }) {
  return `goout-nav-pill ${isActive ? 'goout-nav-pill-active' : ''}`;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { addToast } = useToast();

  return (
    <div className="goout-page-shell goout-app-mesh relative min-h-screen">
      <header className="goout-header-hud sticky top-0 z-40 border-b border-white/40 bg-white/55 backdrop-blur-xl shadow-sm shadow-slate-900/5 motion-safe:goout-animate-in">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-[4.25rem] gap-4">
            <NavLink
              to="/app"
              className="goout-brand-link font-display text-xl font-bold tracking-tight sm:text-2xl">
              GoOut
            </NavLink>
            <nav className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
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
              <div className="pl-1 sm:pl-2 flex items-center border-l border-slate-200/80 ml-0.5 sm:ml-1">
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
