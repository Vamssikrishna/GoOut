import { useState, useEffect } from 'react';
import api from '../../api/client';

export default function GreenMode({ userLocation }) {
  const [stats, setStats] = useState(null);
  const [weight, setWeight] = useState(65);

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => setWeight(data.weight || 65)).catch(() => {});
  }, []);

  useEffect(() => {
    const fetch = () => {
      api.get('/visits/stats')
        .then(({ data }) => setStats(data))
        .catch(() => setStats({ totalVisits: 0, totalSaved: 0, totalDistance: 0, caloriesBurned: 0, co2Saved: 0 }));
    };
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, []);

  const updateWeight = () => {
    api.put('/users/profile', { weight }).then(() => {}).catch(() => {});
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-display font-semibold text-lg mb-4">Green Mode</h2>
        <p className="text-slate-600 text-sm mb-4">Calories = Distance × 0.75 × Weight (kg). CO₂ = Distance × 100g/km (bike emission). Velocity check: no Green Points if speed &gt; 10 km/h.</p>
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm font-medium">Your weight (kg)</label>
          <input type="number" value={weight} onChange={(e) => setWeight(Number(e.target.value) || 65)} min={30} max={150} className="w-20 px-2 py-1 border rounded" />
          <button onClick={updateWeight} className="text-sm text-goout-green hover:underline">Save</button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-goout-mint rounded-xl">
            <p className="text-2xl font-bold text-goout-green">{stats?.caloriesBurned || 0}</p>
            <p className="text-sm text-slate-600">Calories burned</p>
          </div>
          <div className="p-4 bg-goout-mint rounded-xl">
            <p className="text-2xl font-bold text-goout-green">{stats?.co2Saved?.toFixed(2) || '0'} kg</p>
            <p className="text-sm text-slate-600">CO₂ saved</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-xl col-span-2">
            <p className="text-2xl font-bold text-slate-800">{stats?.totalDistance || 0} m</p>
            <p className="text-sm text-slate-600">Distance walked</p>
          </div>
        </div>
      </div>
    </div>
  );
}
