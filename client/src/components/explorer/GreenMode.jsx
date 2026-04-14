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
  const [leaderboard, setLeaderboard] = useState(null);
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
    then(({ data }) => setDashboard(data)).
    catch(() => {
      setDashErr('Could not load green dashboard.');
      setDashboard(null);
    });
  };

  useEffect(() => {
    loadDashboard();
    const t = setInterval(loadDashboard, 45000);
    return () => clearInterval(t);
  }, []);

  const loadLeaderboard = () => {
    const params = {};
    if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng)) {
      params.lat = userLocation.lat;
      params.lng = userLocation.lng;
    }
    api.get('/green/leaderboard', { params }).
    then(({ data }) => setLeaderboard(data)).
    catch(() => setLeaderboard(null));
  };

  useEffect(() => {
    loadLeaderboard();
  }, [userLocation?.lat, userLocation?.lng]);

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
      title: 'Green route on map',
      message: 'Open the Map tab — animated line shows the suggested low-carbon path.'
    });
  };

  const trackingActive = Boolean(userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng));
  const visitRollup = dashboard?.visitRollup;
  const profile = dashboard?.profile;
  const community = dashboard?.community;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-display font-semibold text-lg mb-2">Green Mode</h2>
        <p className="text-slate-600 text-sm mb-4">
          We prioritize walking, cycling, and transit over driving, estimate CO₂ avoided vs a ~192 g/km petrol baseline, and boost credits when you reach sustainability-minded Red Pin merchants on foot. City Concierge (Green tab on chat) ranks eco fields higher and can nudge reusables when the weather is nice.
        </p>
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm">
          <p className="font-medium text-emerald-900">
            {trackingActive ? 'Location: active' : 'Location: waiting'}
          </p>
          <p className="text-emerald-800 mt-1">
            {trackingActive ?
              'Walk to a pinned merchant or public place — verified visits add avoided CO₂ to your profile and may earn carbon credits + badges.' :
              'Enable GPS so we can plan eco routes from you to a merchant.'}
          </p>
        </div>
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm">
          <p className="font-medium text-slate-800">Body weight (from profile)</p>
          {!user ?
            <p className="text-slate-600 mt-1">
              Sign in to use the weight saved on your profile for calorie-related green stats.
            </p> :
            profileWeightKg != null ?
              <p className="text-slate-700 mt-1">
                <span className="text-lg font-semibold tabular-nums text-slate-900">{profileWeightKg}</span>
                <span className="text-slate-600"> kg</span>
                {isExplorer &&
                  <span className="text-slate-600">
                    {' '}
                    — edit on{' '}
                    <Link to="/app/profile" className="text-goout-green font-semibold underline underline-offset-2 hover:text-goout-accent">
                      Profile
                    </Link>
                    .
                  </span>
                }
              </p> :
              <p className="text-slate-600 mt-1">
                {isExplorer ?
                  <>
                    Not set yet. Add your weight under{' '}
                    <Link to="/app/profile" className="text-goout-green font-semibold underline underline-offset-2 hover:text-goout-accent">
                      Profile → Account &amp; safety
                    </Link>{' '}
                    so visits and estimates can use it.
                  </> :
                  'Explorer accounts can set body weight in Profile for calorie estimates.'}
              </p>
          }
        </div>
        {dashErr && <p className="text-sm text-amber-700 mb-2">{dashErr}</p>}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-goout-mint rounded-xl">
            <p className="text-2xl font-bold text-goout-green">{visitRollup?.caloriesBurned ?? '—'}</p>
            <p className="text-sm text-slate-600">Calories (visits)</p>
          </div>
          <div className="p-4 bg-goout-mint rounded-xl">
            <p className="text-2xl font-bold text-goout-green">{profile?.carbonCredits ?? '—'}</p>
            <p className="text-sm text-slate-600">Carbon credits</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-xl col-span-2">
            <p className="text-2xl font-bold text-slate-800">{visitRollup?.totalDistanceMeters ?? 0} m</p>
            <p className="text-sm text-slate-600">Distance logged on visits</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-xl col-span-2 text-xs text-slate-600">
            <p>
              <strong className="text-slate-800">Profile CO₂ avoided (cumulative):</strong>{' '}
              {profile?.greenStats?.totalCO2Saved != null ? `${profile.greenStats.totalCO2Saved} g` : '—'}
            </p>
            <p className="mt-1">
              <strong className="text-slate-800">Community:</strong>{' '}
              {community ?
                `~${community.totalCo2Kg} kg CO₂ logged across ${community.explorerCount} explorers (${community.totalWalks} green trips).` :
                '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="font-display font-semibold text-lg mb-2">Eco-friendly routing</h3>
        <p className="text-slate-600 text-sm mb-3">
          Compares walking, cycling, and transit (when Google Directions supports it) to driving. &quot;Green path&quot; score bumps routes whose steps mention parks, plazas, or pedestrian ways — not live tree or pollution sensors.
        </p>
        {withCoords.length === 0 ?
        <p className="text-sm text-amber-800">Search the Map tab for merchants first.</p> :

        <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-slate-600">Destination</span>
              <select
              value={idDest}
              onChange={(e) => setIdDest(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">

                {withCoords.map((b) =>
              <option key={b._id} value={b._id}>{b.mapDisplayName || b.name}</option>
              )}
              </select>
            </label>
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

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="font-display font-semibold text-lg mb-3">Badges</h3>
        <ul className="space-y-2">
          {(dashboard?.badges || []).map((b) =>
          <li
            key={b.id}
            className={`flex justify-between items-center text-sm px-3 py-2 rounded-lg border ${
            b.earned ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`
            }>
            
              <span>{b.label}</span>
              {b.earned ?
            <span className="text-emerald-700 font-medium">Earned</span> :

            <span className="text-slate-500">{b.progress != null ? `${b.progress}%` : ''}</span>
            }
            </li>
          )}
        </ul>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="font-display font-semibold text-lg mb-3">Neighborhood leaderboard</h3>
        <p className="text-xs text-slate-500 mb-2">Ranked by combined green activity (carbon credits + logged CO₂). Requires explorers who saved a map location.</p>
        {leaderboard?.you &&
        <p className="text-sm text-slate-700 mb-2">
            Your score: <strong>{Math.round(leaderboard.you.score)}</strong> · CO₂ logged:{' '}
            {leaderboard.you.co2SavedGrams} g
          </p>
        }
        <ul className="space-y-2">
          {(leaderboard?.leaderboard || []).slice(0, 12).map((row, i) =>
          <li key={row.id || i} className="flex justify-between text-sm py-2 border-b border-slate-100 last:border-0">
              <span className="font-medium text-slate-800 truncate pr-2">
                {i + 1}. {row.name}
              </span>
              <span className="text-emerald-700 shrink-0">{Math.round(row.score)}</span>
            </li>
          )}
        </ul>
        {!leaderboard?.leaderboard?.length &&
        <p className="text-sm text-slate-500">No ranked explorers yet — be the first to log walks.</p>
        }
      </div>
    </div>);

}
