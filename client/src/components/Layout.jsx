import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

function getInitials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const [showProfile, setShowProfile] = useState(false);
  const isMerchant = user?.role === 'merchant';
  const navClass = ({ isActive }) =>
    `px-4 py-2 rounded-lg font-medium transition ${isActive ? 'bg-goout-green text-white' : 'text-slate-600 hover:bg-slate-100'}`;

  return (
    <div className="min-h-screen bg-slate-50 relative">
      <header className="bg-white/90 backdrop-blur border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <NavLink to="/app" className="font-display font-bold text-xl text-goout-green">
              GoOut
            </NavLink>
            <nav className="flex items-center gap-3">
              {user?.role !== 'merchant' && (
                <>
                  <NavLink to="/app" end className={navClass}>Explore</NavLink>
                  <NavLink to="/app/buddies" className={navClass}>Buddies</NavLink>
                </>
              )}
              {user?.role === 'merchant' && (
                <NavLink to="/app/merchant" className={navClass}>Merchant</NavLink>
              )}
              <div className="ml-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowProfile(true)}
                  className="flex items-center gap-2 rounded-full border border-slate-200 px-2 py-1 hover:bg-slate-50 transition"
                >
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-goout-green text-xs font-semibold text-white">
                    {getInitials(user?.name)}
                  </span>
                  <div className="hidden sm:flex flex-col items-start leading-tight">
                    <span className="text-sm text-slate-800 font-medium">{user?.name}</span>
                    <span className="text-[11px] text-slate-500 capitalize">{user?.role || 'explorer'}</span>
                  </div>
                  {user?.verified && (
                    <span className="hidden sm:inline text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                      ✓ Verified
                    </span>
                  )}
                </button>
              </div>
            </nav>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>

      {showProfile && (
        <div
          className="fixed inset-0 z-50 flex"
          aria-modal="true"
          role="dialog"
        >
          <div
            className="flex-1 bg-black/40"
            onClick={() => setShowProfile(false)}
          />
          <aside className="w-80 max-w-full h-full bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 text-slate-50 shadow-2xl border-l border-slate-800/60 p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-goout-green text-white font-semibold shadow-md shadow-goout-green/40">
                  {getInitials(user?.name)}
                </div>
                <div>
                  <p className="font-semibold text-sm text-slate-50">{user?.name}</p>
                  <p className="text-[11px] text-slate-400 capitalize">{user?.role || 'explorer'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProfile(false)}
                className="text-slate-400 hover:text-slate-100 text-xs"
              >
                Close
              </button>
            </div>
            <div className="space-y-4 text-sm text-slate-100 flex-1 overflow-y-auto pt-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Role panel</p>
                <p className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${isMerchant ? 'bg-amber-500/20 text-amber-200' : 'bg-emerald-500/20 text-emerald-200'}`}>
                  {isMerchant ? 'Merchant profile' : 'Explorer profile'}
                </p>
              </div>
              {user?.email && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Account</p>
                  <p className="text-xs break-all">{user.email}</p>
                </div>
              )}
              {!isMerchant && user?.emergencyContact && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Emergency contact</p>
                  <p className="text-xs">{user.emergencyContact}</p>
                </div>
              )}
              {!isMerchant && Array.isArray(user?.interests) && user.interests.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Interests</p>
                  <div className="flex flex-wrap gap-1.5">
                    {user.interests.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full bg-slate-800 text-[11px] text-slate-100"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!isMerchant && user?.greenStats && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Green mode</p>
                  <div className="text-[11px] text-slate-200 space-y-1">
                    <p>Walks: <span className="font-medium">{user.greenStats.totalWalks || 0}</span></p>
                    <p>Calories burned: <span className="font-medium">{user.greenStats.totalCaloriesBurned || 0}</span></p>
                    <p>CO₂ saved: <span className="font-medium">{user.greenStats.totalCO2Saved || 0}</span> g</p>
                  </div>
                </div>
              )}
              {isMerchant && (
                <>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Merchant workspace</p>
                    <p className="text-xs text-slate-200">Use the Merchant dashboard to manage business profile, flash deals, crowd status, and analytics.</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Business link status</p>
                    <p className="text-xs text-slate-200">
                      {user?.businessId ? 'Business connected to this account' : 'No business linked yet'}
                    </p>
                  </div>
                  {user?.verified && (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Verification</p>
                      <p className="text-xs text-slate-200">Verified merchant account</p>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="pt-4 border-t border-slate-800 mt-4">
              <button
                type="button"
                onClick={() => {
                  addToast({ type: 'info', title: 'Logged out', message: 'See you soon.' });
                  logout();
                }}
                className="w-full px-4 py-2 text-sm font-medium text-red-300 border border-red-500/40 rounded-lg hover:bg-red-500/10"
              >
                Logout
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
