import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';

function coordsOf(b) {
  const c = b?.location?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export default function GreenMode({ userLocation, businesses = [], onGreenEcoRoute, onRequestMapTab }) {
  const { addToast } = useToast();
  const { user } = useAuth();
  const isExplorer = user?.role !== 'merchant';
  const profileWeightKg =
    user != null && user.weight != null && Number.isFinite(Number(user.weight)) ? Number(user.weight) : null;
  const [dashboard, setDashboard] = useState(null);
  const [dashErr, setDashErr] = useState('');
  const [idDest, setIdDest] = useState('');
  const [bundle, setBundle] = useState(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleErr, setBundleErr] = useState('');

  const withCoords = useMemo(() => (businesses || []).filter((b) => coordsOf(b)), [businesses]);

  useEffect(() => {
    if (withCoords.length && !idDest) setIdDest(String(withCoords[0]._id));
  }, [withCoords, idDest]);

  const loadDashboard = () => {
    setDashErr('');
    api.get('/green/dashboard').
    then(({ data }) => setDashboard(data || null)).
    catch(() => {
      setDashErr('Could not load live green stats right now.');
    });
  };

  useEffect(() => {
    loadDashboard();
    const t = setInterval(loadDashboard, 45000);
    return () => clearInterval(t);
  }, []);

  const runGreenBundle = async () => {
    setBundleErr('');
    setBundle(null);
    if (!userLocation || !Number.isFinite(userLocation.lat)) {
      setBundleErr('Location required for eco routing.');
      return;
    }
    const b = withCoords.find((x) => String(x._id) === String(idDest));
    const dest = b ? coordsOf(b) : null;
    if (!dest) {
      setBundleErr('Pick a merchant with a map pin.');
      return;
    }
    setBundleLoading(true);
    try {
      const { data } = await api.post('/directions/green-bundle', {
        origin: userLocation,
        destination: dest,
        destinationName: b.mapDisplayName || b.name
      });
      setBundle(data);
    } catch (e) {
      setBundleErr(e.response?.data?.error || e.message || 'Routing failed');
    } finally {
      setBundleLoading(false);
    }
  };

  const showRecommendedOnMap = () => {
    const r = bundle?.recommended;
    if (!r?.geometryLatLng?.length) {
      addToast({ type: 'error', title: 'No route', message: 'Compute a green bundle first.' });
      return;
    }
    onGreenEcoRoute?.({
      geometryLatLng: r.geometryLatLng,
      co2SavedGrams: r.co2SavedVsCarGrams,
      modeLabel: r.mode
    });
    onRequestMapTab?.();
    addToast({
      type: 'success',
      title: 'Green route',
      message: 'Map tab: animated low-carbon path.'
    });
  };

  const trackingActive = Boolean(userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng));
  const walkingRouteActive = String(bundle?.recommended?.mode || '').toLowerCase().includes('walk');
  const visitRollup = dashboard?.visitRollup;
  const profile = dashboard?.profile;
  const community = dashboard?.community;
  const savedDistance = Number(visitRollup?.totalDistanceMeters || 0);
  const savedCalories = Number(visitRollup?.caloriesBurned || 0);
  const savedCredits = Number(profile?.carbonCredits || visitRollup?.carbonCreditsEarned || 0);
  const savedCo2 = Number(visitRollup?.co2SavedGrams || profile?.greenStats?.totalCO2Saved || 0);
  const streakDays = Number(visitRollup?.streakDays || 0);

  return (
    <div className="space-y-6">
      <div className="goout-premium-card rounded-3xl p-6">
        <div className="grid gap-6 lg:grid-cols-[0.95fr,1.05fr] lg:items-stretch">
          <div>
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm">
              <p className="font-medium text-emerald-900">
                {trackingActive ? 'Location: active' : 'Location: waiting'}
              </p>
              <p className="text-emerald-800 mt-1">
                {trackingActive ?
                  'Walk to a pin—verified visits stack CO₂, credits, badges.' :
                  'Turn on GPS for eco routes.'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/85 px-4 py-3 text-sm">
              <p className="font-medium text-slate-800">Body weight (from profile)</p>
              {!user ?
                <p className="text-slate-600 mt-1">
                  Sign in to use profile weight for calories.
                </p> :
                profileWeightKg != null ?
                  <p className="text-slate-700 mt-1">
                    <span className="text-lg font-semibold tabular-nums text-slate-900">{profileWeightKg}</span>
                    <span className="text-slate-600"> kg</span>
                    {isExplorer &&
                      <span className="text-slate-600">
                        {' '}
                        {' '}
                        <Link to="/app/profile" className="text-goout-green font-semibold underline underline-offset-2 hover:text-goout-accent">
                          Edit
                        </Link>
                      </span>
                    }
                  </p> :
                  <p className="text-slate-600 mt-1">
                    {isExplorer ?
                      <>
                        Add weight in{' '}
                        <Link to="/app/profile" className="text-goout-green font-semibold underline underline-offset-2 hover:text-goout-accent">
                          Profile
                        </Link>
                        .
                      </> :
                      'Set weight in Profile for calories.'}
                  </p>
              }
            </div>
            {dashErr && <p className="text-sm text-amber-700 mt-3">{dashErr}</p>}
          </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-emerald-200 bg-white/80 shadow-sm">
            <p className="text-2xl font-bold text-emerald-700 tabular-nums">{savedCalories || 0}</p>
            <p className="text-sm text-slate-600">Calories burned (cumulative)</p>
          </div>
          <div className={`p-4 rounded-xl border border-emerald-200 bg-white/80 shadow-sm ${walkingRouteActive ? 'goout-carbon-live' : ''}`}>
            <p className="text-2xl font-bold text-emerald-700 font-mono tabular-nums">{savedCredits.toFixed(1)}</p>
            <p className="text-sm text-slate-600">Carbon credits (wallet)</p>
          </div>
          <div className="p-4 rounded-xl border border-emerald-200 bg-white/80 shadow-sm col-span-2">
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{savedDistance} m</p>
            <p className="text-sm text-slate-600">Verified walk distance (cumulative)</p>
          </div>
          <div className="p-4 rounded-xl border border-emerald-200 bg-white/80 shadow-sm col-span-2 text-xs text-slate-600">
            <p>
              <strong className="text-slate-800">Profile CO₂ avoided (cumulative):</strong>{' '}
              {`${savedCo2} g`}
            </p>
            <p className="mt-1">
              <strong className="text-slate-800">Current streak:</strong> {streakDays} day(s)
            </p>
            <p className="mt-1">
              <strong className="text-slate-800">Community</strong>{' '}
              {community ?
                `~${community.totalCo2Kg} kg CO₂ · ${community.explorerCount} explorers · ${community.totalWalks} trips` :
                '—'}
            </p>
          </div>
        </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
      <div className="goout-premium-card rounded-2xl p-6 lg:col-span-7">
        <h3 className="font-display font-semibold text-lg mb-2">Eco-friendly routing</h3>
        <p className="text-slate-600 text-sm mb-3">
          Walk, bike, transit vs drive. Green path = parks &amp; pedestrian-friendly steps (heuristic).
        </p>
        {withCoords.length === 0 ?
        <p className="text-sm text-amber-800">Search Map for pins first.</p> :

        <div className="space-y-3">
            <div>
              <span className="text-sm font-medium text-slate-700">Choose destination</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {withCoords.map((b) =>
                  <button
                    key={b._id}
                    type="button"
                    onClick={() => setIdDest(b._id)}
                    className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                      String(idDest) === String(b._id)
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200 hover:bg-orange-50'
                    }`}
                  >
                    <span className="block font-semibold">{b.mapDisplayName || b.name}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{b.category || 'Place'}</span>
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
              type="button"
              disabled={bundleLoading}
              onClick={runGreenBundle}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">

              {bundleLoading ? 'Computing…' : 'Plan low-carbon routes'}
            </button>
              {bundle?.recommended &&
            <button
              type="button"
              onClick={showRecommendedOnMap}
              className="px-4 py-2 rounded-lg border border-emerald-600 text-emerald-800 font-medium hover:bg-emerald-50">

              Show best route on map
            </button>
            }
            </div>
            {bundleErr && <p className="text-sm text-red-600">{bundleErr}</p>}
            {bundle?.microMobilityHint &&
          <p className="text-xs text-slate-600 border border-slate-100 rounded-lg px-3 py-2 bg-slate-50">{bundle.microMobilityHint}</p>
          }
            {bundle?.recommended &&
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm">
                <p className="font-semibold text-emerald-900">Suggested: {bundle.recommended.mode}</p>
                <p className="text-emerald-800 mt-1">
                  ~{Math.round(bundle.recommended.durationSeconds / 60)} min ·{' '}
                  {(bundle.recommended.distanceMeters / 1000).toFixed(2)} km · avoids ~{' '}
                  <strong>{Math.round(bundle.recommended.co2SavedVsCarGrams)} g CO₂</strong> vs car for the same trip length baseline
                </p>
              </div>
          }
            {bundle?.candidates?.length > 1 &&
          <ul className="text-xs text-slate-600 space-y-1 mt-2">
                {bundle.candidates.map((c) =>
              <li key={c.mode}>
                    <span className="font-medium capitalize">{c.mode}</span>: {Math.round(c.durationSeconds / 60)} min, ~{' '}
                    {Math.round(c.co2SavedVsCarGrams)} g saved vs car, path score {c.greenPathScore}
                  </li>
              )}
              </ul>
          }
            {bundle?.assumptionsNote && <p className="text-[11px] text-slate-500 mt-2">{bundle.assumptionsNote}</p>}
          </div>
        }
      </div>

      <div className="goout-premium-card rounded-2xl p-6 lg:col-span-5">
        <h3 className="font-display font-semibold text-lg mb-3">Badges & milestones</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {(dashboard?.badges || []).map((b) =>
          <li
            key={b.id}
            className={`rounded-xl border p-3 text-sm shadow-sm transition ${
            b.earned ? 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-lime-50' : 'border-slate-200 bg-slate-50'}`
            }>
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-slate-800">{b.label}</span>
                {b.earned ?
                  <span className="inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">Unlocked</span> :
                  <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">In progress</span>
                }
              </div>
              {b.earned ? (
                <p className="mt-2 text-xs text-emerald-700">Completed and active</p>
              ) : (
                <div className="mt-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, Number(b.progress) || 0))}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{b.progress != null ? `${b.progress}% complete` : 'Progress pending'}</p>
                </div>
              )}
            </li>
          )}
        </ul>
      </div>
      </div>
    </div>);

}
