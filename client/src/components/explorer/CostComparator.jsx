import { useState, useEffect } from 'react';
import api from '../../api/client';

const DELIVERY_FEE = 40;
const PLATFORM_FEE = 15;
const PACKAGING = 25;
const TIP_PERCENT = 10;

function goOutCost(b) { return b.avgPrice || 0; }
function deliveryCost(b) {
  const base = b.avgPrice || 0;
  return base + DELIVERY_FEE + PLATFORM_FEE + PACKAGING + Math.round((base * TIP_PERCENT) / 100);
}
function savings(b) { return deliveryCost(b) - goOutCost(b); }
function isHighValue(b) { const base = goOutCost(b); return base > 0 && savings(b) / base > 0.5; }

export default function CostComparator({ userLocation, businesses }) {
  const [visits, setVisits] = useState([]);
  const [visitStats, setVisitStats] = useState(null);

  useEffect(() => {
    const fetch = () => {
      api.get('/visits').then(({ data }) => setVisits(data)).catch(() => setVisits([]));
      api.get('/visits/stats').then(({ data }) => setVisitStats(data)).catch(() => setVisitStats(null));
    };
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, []);

  const sample = businesses.slice(0, 5);
  const totalGoOut = sample.reduce((s, b) => s + goOutCost(b), 0);
  const totalDelivery = sample.reduce((s, b) => s + deliveryCost(b), 0);
  const totalSavings = totalDelivery - totalGoOut;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-display font-semibold text-lg mb-4">Cost-Benefit Comparator</h2>
        <p className="text-slate-600 text-sm mb-4">Savings = Delivery (₹{DELIVERY_FEE}) + Platform (₹{PLATFORM_FEE}) + Packaging (₹{PACKAGING}) + ~{TIP_PERCENT}% tip. Small orders: fees can exceed food cost.</p>
        {visitStats && visitStats.totalVisits > 0 && (
          <div className="mb-6 p-4 bg-goout-mint rounded-xl">
            <p className="font-medium text-goout-dark">Places you visited (location-verified)</p>
            <p className="text-2xl font-bold text-goout-green mt-1">₹{visitStats.totalSaved} saved</p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2">Place</th>
                <th className="text-right py-2">GoOut</th>
                <th className="text-right py-2">Delivery</th>
                <th className="text-right py-2 text-green-600">You Save</th>
              </tr>
            </thead>
            <tbody>
              {sample.map((b) => (
                <tr key={b._id} className="border-b border-slate-100">
                  <td className="py-2">
                    <span>{b.name}</span>
                    {isHighValue(b) && <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-bold rounded">High Value Saving</span>}
                  </td>
                  <td className="text-right">₹{goOutCost(b)}</td>
                  <td className="text-right">₹{deliveryCost(b)}</td>
                  <td className="text-right text-green-600 font-medium">₹{savings(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 p-4 bg-goout-mint rounded-xl">
          <p className="text-slate-700">
            <strong>Summary:</strong> Walking saves <span className="text-goout-green font-bold">₹{totalSavings}</span> vs delivery for these {sample.length} places.
          </p>
        </div>
      </div>
      {visits.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h3 className="font-display font-semibold text-lg mb-4">Your visit history</h3>
          <ul className="space-y-2">
            {visits.slice(0, 10).map((v) => (
              <li key={v._id} className="flex justify-between py-2 border-b border-slate-100 last:border-0">
                <span>{v.businessId?.name}</span>
                <span className="text-goout-green font-medium">Saved ₹{deliveryCost(v.businessId || {}) - goOutCost(v.businessId || {})}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
