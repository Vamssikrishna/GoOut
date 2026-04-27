import { useMemo } from 'react';

const CROWD_STEPS = [
  { level: 0, label: 'Empty', hint: '0%' },
  { level: 33, label: 'Quiet', hint: 'Light' },
  { level: 66, label: 'Busy', hint: 'Peak-ish' },
  { level: 100, label: 'Full', hint: 'Max' }
];

function sumKey(rows, key, start, end) {
  return rows.slice(start, end).reduce((s, d) => s + (Number(d[key]) || 0), 0);
}

function pctChange(rows, key) {
  if (!rows?.length || rows.length < 8) return { text: 'Collecting trend', tone: 'muted' };
  const last = sumKey(rows, key, -7, rows.length);
  const prev = sumKey(rows, key, -14, -7);
  if (prev === 0 && last === 0) return { text: 'Flat vs prior week', tone: 'muted' };
  if (prev === 0) return { text: `+${last} vs prior week`, tone: 'up' };
  const pct = Math.round(((last - prev) / prev) * 100);
  if (pct > 0) return { text: `↑ ${pct}% vs prior week`, tone: 'up' };
  if (pct < 0) return { text: `↓ ${Math.abs(pct)}% vs prior week`, tone: 'down' };
  return { text: 'Steady vs prior week', tone: 'muted' };
}

function toneClass(tone) {
  if (tone === 'up') return 'text-emerald-600';
  if (tone === 'down') return 'text-amber-700';
  return 'text-slate-500';
}

function hourLabel(hourNum) {
  const h = Number(hourNum);
  if (!Number.isFinite(h)) return '--:00';
  const dt = new Date(2000, 0, 1, h, 0, 0, 0);
  return dt.toLocaleTimeString(undefined, { hour: 'numeric', hour12: true });
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 1000) / 10));
}

function MetricCard({ title, value, subtitle, trend }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500 font-semibold">{title}</p>
      <p className="mt-1 text-2xl md:text-3xl font-display font-bold text-slate-900">{value}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      {trend ? <p className={`mt-1 text-xs font-medium ${toneClass(trend.tone)}`}>{trend.text}</p> : null}
    </div>
  );
}

export default function MerchantAnalyticsPanel({ analytics, business, onCrowdChange }) {
  const daily = analytics?.daily || [];
  const last10 = daily.slice(-10);
  const last30Views = sumKey(daily, 'profileViews', -30, daily.length);
  const last30Clicks = sumKey(daily, 'offerClicks', -30, daily.length);
  const ctr = percent(last30Clicks, last30Views);

  const viewTrend = pctChange(daily, 'profileViews');
  const clickTrend = pctChange(daily, 'offerClicks');

  const topDay = useMemo(() => {
    if (!daily.length) return null;
    return [...daily].sort((a, b) => (Number(b.profileViews) || 0) - (Number(a.profileViews) || 0))[0];
  }, [daily]);

  const hourly = useMemo(() => {
    const raw = analytics?.peakHours || {};
    const byHour = new Map(
      Object.entries(raw)
        .map(([h, count]) => [Number(h), Number(count) || 0])
        .filter(([h]) => Number.isFinite(h))
    );
    return Array.from({ length: 24 }, (_, i) => ({
      hourNum: i,
      count: byHour.get(i) || 0
    }));
  }, [analytics?.peakHours]);

  const maxHourly = hourly.reduce((m, row) => Math.max(m, row.count), 0) || 1;
  const topHour = useMemo(
    () => [...hourly].sort((a, b) => b.count - a.count)[0],
    [hourly]
  );

  const dayParts = useMemo(() => {
    const buckets = [
      { key: 'morning', label: 'Morning', range: '5–12', total: 0 },
      { key: 'afternoon', label: 'Afternoon', range: '12–17', total: 0 },
      { key: 'evening', label: 'Evening', range: '17–22', total: 0 },
      { key: 'night', label: 'Night', range: '22–5', total: 0 }
    ];
    hourly.forEach((h) => {
      if (h.hourNum >= 5 && h.hourNum < 12) buckets[0].total += h.count;
      else if (h.hourNum >= 12 && h.hourNum < 17) buckets[1].total += h.count;
      else if (h.hourNum >= 17 && h.hourNum < 22) buckets[2].total += h.count;
      else buckets[3].total += h.count;
    });
    const all = buckets.reduce((s, b) => s + b.total, 0) || 1;
    return buckets.map((b) => ({ ...b, pct: percent(b.total, all) }));
  }, [hourly]);

  const activityScore = Math.min(100, Math.round((last30Views * 0.12) + (last30Clicks * 0.35)));
  const conversionScore = Math.min(100, Math.round(ctr * 2));
  const discoverabilityScore = Math.min(100, Math.round((Number(topHour?.count || 0) / maxHourly) * 100));

  const maxDayViews = last10.reduce((m, d) => Math.max(m, Number(d.profileViews) || 0), 0) || 1;
  const maxDayClicks = last10.reduce((m, d) => Math.max(m, Number(d.offerClicks) || 0), 0) || 1;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.35em] text-emerald-700">Merchant intelligence</p>
            <h2 className="mt-2 font-display text-2xl md:text-3xl font-bold text-slate-900">Performance command center</h2>
            <p className="mt-2 text-sm text-slate-600 max-w-2xl">
              Advanced insights with visual charts: trend movement, conversion quality, day-part demand, and peak-time radar from your live store data.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 font-semibold">
            Rolling 30-day intelligence
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <MetricCard title="Profile views" value={last30Views.toLocaleString()} trend={viewTrend} />
          <MetricCard title="Offer clicks" value={last30Clicks.toLocaleString()} trend={clickTrend} />
          <MetricCard title="CTR quality" value={`${ctr}%`} subtitle="Clicks per 100 views" />
          <MetricCard
            title="Peak window"
            value={topHour?.count ? hourLabel(topHour.hourNum) : '—'}
            subtitle={topHour?.count ? `${topHour.count} profile opens` : 'No hourly data yet'}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <h3 className="font-display text-lg font-bold text-slate-900">Performance bar chart</h3>
              <p className="text-sm text-slate-600">Recent 10-day views vs clicks</p>
            </div>
            {topDay && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Best day: {topDay.date}
              </span>
            )}
          </div>

          {!last10.length ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
              No daily analytics yet. Views and clicks will appear after explorers open your profile.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  Views
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                  Clicks
                </span>
              </div>
              <div className="h-56 flex items-end gap-2 sm:gap-3">
                {last10.map((d) => {
                  const v = Number(d.profileViews) || 0;
                  const c = Number(d.offerClicks) || 0;
                  const localMax = Math.max(1, ...last10.map((x) => Math.max(Number(x.profileViews) || 0, Number(x.offerClicks) || 0)));
                  return (
                    <div key={d.date} className="flex-1 min-w-0 flex flex-col justify-end items-center gap-1">
                      <div className="w-full flex items-end justify-center gap-1">
                        <div
                          className="w-1/3 max-w-3 rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400"
                          style={{ height: `${Math.max(6, (v / localMax) * 170)}px` }}
                          title={`${d.date}: ${v} views`}
                        />
                        <div
                          className="w-1/3 max-w-3 rounded-t-md bg-gradient-to-t from-slate-700 to-slate-500"
                          style={{ height: `${Math.max(6, (c / localMax) * 170)}px` }}
                          title={`${d.date}: ${c} clicks`}
                        />
                      </div>
                      <p className="text-[10px] text-slate-600 truncate max-w-full">{String(d.date || '').slice(5)}</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-600">Hover bars to see per-day values.</p>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-display text-lg font-bold text-slate-900">Quality pie chart</h3>
          <p className="text-xs text-slate-600 mt-1">Traffic vs conversion vs consistency split</p>
          {(() => {
            const slices = [
              { label: 'Traffic', value: Math.max(5, activityScore), color: '#34d399' },
              { label: 'Conversion', value: Math.max(5, conversionScore), color: '#38bdf8' },
              { label: 'Consistency', value: Math.max(5, discoverabilityScore), color: '#a78bfa' }
            ];
            const total = slices.reduce((s, x) => s + x.value, 0) || 1;
            let acc = 0;
            const gradientParts = slices.map((s) => {
              const start = (acc / total) * 100;
              acc += s.value;
              const end = (acc / total) * 100;
              return `${s.color} ${start}% ${end}%`;
            });
            const strongest = [...slices].sort((a, b) => b.value - a.value)[0];
            return (
              <div className="mt-4">
                <div className="mx-auto h-44 w-44 rounded-full border-4 border-slate-200 shadow-xl relative" style={{ background: `conic-gradient(${gradientParts.join(', ')})` }}>
                  <div className="absolute inset-[22%] rounded-full bg-white border border-slate-200 flex items-center justify-center text-center px-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Top</p>
                      <p className="text-sm font-semibold text-slate-900">{strongest.label}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {slices.map((s) => (
                    <div key={s.label} className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-2 text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.label}
                      </span>
                      <span className="font-semibold text-slate-900">{Math.round((s.value / total) * 100)}%</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  Recommendation: schedule flash deals 30-45 mins before your peak hour to improve conversion lift.
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-7">
          <div className="mb-4">
            <h3 className="font-display text-lg font-bold text-slate-900">Peak-hour radar</h3>
            <p className="text-sm text-slate-600">24-hour intensity strip (darker = higher demand)</p>
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-2">
            {hourly.map((h) => {
              const level = percent(h.count, maxHourly);
              const alpha = 0.08 + (level / 100) * 0.7;
              return (
                <div
                  key={h.hourNum}
                  className="rounded-lg border border-slate-200 p-2 text-center"
                  style={{ backgroundColor: `rgba(16,185,129,${alpha})` }}
                  title={`${hourLabel(h.hourNum)} · ${h.count} views`}>
                  <p className="text-[10px] font-semibold text-slate-700">{h.hourNum}</p>
                  <p className="text-[10px] text-slate-600 mt-1">{h.count}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h3 className="font-display text-lg font-bold text-slate-900">Day-part distribution</h3>
              <p className="text-sm text-slate-600">When your profile gets discovered most</p>
            </div>
            <div className="space-y-3">
              {dayParts.map((d) => (
                <div key={d.key} className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="font-semibold text-slate-800">{d.label} <span className="text-slate-500 font-normal">({d.range})</span></span>
                    <span className="text-slate-600">{d.total} views · {d.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-goout-green to-emerald-400"
                      style={{ width: `${d.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">Floor signal control</h3>
                <p className="text-xs text-slate-600 mt-1">Adjust crowd state visible to nearby explorers</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full sm:w-auto">
                {CROWD_STEPS.map(({ level, label, hint }) => {
                  const active = business?.crowdLevel === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => onCrowdChange?.(level)}
                      className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-all ${
                        active ?
                          'border-emerald-300 bg-emerald-500 text-white shadow-sm' :
                          'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}>
                      <span className="block text-[11px] opacity-80">{hint}</span>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
