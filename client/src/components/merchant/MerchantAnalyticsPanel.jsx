import { useMemo, useId } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell
} from 'recharts';

const CHART_TOOLTIP = {
  contentStyle: {
    background: 'rgba(15, 23, 42, 0.92)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: '12px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
    padding: '10px 14px'
  },
  labelStyle: { color: '#94a3b8', fontSize: 11, marginBottom: 4 },
  itemStyle: { fontSize: 12 }
};

function sumKey(rows, key, start, end) {
  return rows.slice(start, end).reduce((s, d) => s + (Number(d[key]) || 0), 0);
}

function trendLabel(rows, key) {
  if (!rows?.length || rows.length < 8) return null;
  const last = sumKey(rows, key, -7, rows.length);
  const prev = sumKey(rows, key, -14, -7);
  if (prev === 0 && last === 0) return { text: 'Flat', tone: 'muted' };
  if (prev === 0) return { text: `+${last} vs prior week`, tone: 'up' };
  const pct = Math.round(((last - prev) / prev) * 100);
  if (pct > 0) return { text: `↑ ${pct}% vs prior 7d`, tone: 'up' };
  if (pct < 0) return { text: `↓ ${Math.abs(pct)}% vs prior 7d`, tone: 'down' };
  return { text: 'Steady', tone: 'muted' };
}

function MiniSpark({ data, dataKey, color }) {
  const uid = useId().replace(/:/g, '');
  const gradId = `spark-${dataKey}-${uid}`;
  if (!data?.length) return <div className="h-10 w-full rounded-md bg-slate-100/80" />;
  return (
    <div className="h-10 w-full opacity-90">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} isAnimationActive />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiCard({ title, value, sub, sparkData, sparkKey, sparkColor, trend }) {
  const main =
    typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-gradient-to-br from-white/95 via-white/88 to-emerald-50/30 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-sm transition-all duration-300 hover:border-emerald-300/50 hover:shadow-xl hover:shadow-emerald-500/10">
      <div className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-gradient-to-br from-emerald-400/20 to-cyan-400/10 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
      <p className="relative text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <p className="relative mt-2 font-display text-3xl font-bold tabular-nums tracking-tight text-slate-900 md:text-4xl">
        {main}
      </p>
      {trend && (
        <p
          className={`relative mt-1 text-xs font-medium ${
            trend.tone === 'up'
              ? 'text-emerald-600'
              : trend.tone === 'down'
                ? 'text-amber-700'
                : 'text-slate-500'
          }`}>
          {trend.text}
        </p>
      )}
      {sub && <p className="relative mt-1 text-xs text-slate-500">{sub}</p>}
      <div className="relative mt-4">
        {sparkData?.length ? <MiniSpark data={sparkData} dataKey={sparkKey} color={sparkColor} /> : null}
      </div>
    </div>
  );
}

const CROWD_STEPS = [
  { level: 0, label: 'Empty', hint: '0%' },
  { level: 33, label: 'Quiet', hint: 'Light' },
  { level: 66, label: 'Busy', hint: 'Peak-ish' },
  { level: 100, label: 'Full', hint: 'Max' }
];

export default function MerchantAnalyticsPanel({ analytics, business, onCrowdChange }) {
  const daily = analytics?.daily || [];
  const last14 = daily.slice(-14);

  const peakEntries = useMemo(() => {
    const raw = analytics?.peakHours || {};
    return Object.entries(raw)
      .map(([h, count]) => ({
        hourNum: Number(h),
        label: `${h}:00`,
        count: Number(count) || 0
      }))
      .filter((e) => Number.isFinite(e.hourNum))
      .sort((a, b) => a.hourNum - b.hourNum);
  }, [analytics?.peakHours]);

  const totals = {
    views: analytics?.profileViews ?? 0,
    clicks: analytics?.offerClicks ?? 0
  };
  const ctr =
    totals.views > 0 ? Math.min(100, Math.round((totals.clicks / totals.views) * 1000) / 10) : 0;

  const chartData = useMemo(
    () =>
      daily.map((d) => ({
        ...d,
        shortDate: d.date?.slice(5) || d.date
      })),
    [daily]
  );

  const viewsTrend = trendLabel(daily, 'profileViews');
  const clicksTrend = trendLabel(daily, 'offerClicks');

  const maxPeak = peakEntries.reduce((m, e) => Math.max(m, e.count), 0) || 1;

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-emerald-200/40 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 p-6 text-white shadow-2xl shadow-emerald-900/20 md:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.06)_1px,transparent_1px)] bg-[size:24px_24px] opacity-80" />
        <div className="pointer-events-none absolute -left-20 top-0 h-64 w-64 rounded-full bg-emerald-500/25 blur-[80px]" />
        <div className="pointer-events-none absolute -right-10 bottom-0 h-48 w-48 rounded-full bg-cyan-500/20 blur-[70px]" />

        <div className="relative flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.35em] text-emerald-400/90">Telemetry</p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight md:text-3xl">Performance command center</h2>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Live counters, 30-day trajectories, and visit rhythm. One view or click per explorer per 24h — daily rollups.
            </p>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 backdrop-blur-sm md:mt-0">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40 motion-reduce:animate-none motion-reduce:opacity-0" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs font-medium text-slate-300">Streaming dashboard</span>
          </div>
        </div>

        <div className="relative mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="Profile views"
            value={totals.views}
            sparkData={last14}
            sparkKey="profileViews"
            sparkColor="#34d399"
            trend={viewsTrend}
          />
          <KpiCard
            title="Offer clicks"
            value={totals.clicks}
            sparkData={last14}
            sparkKey="offerClicks"
            sparkColor="#38bdf8"
            trend={clicksTrend}
          />
          <KpiCard
            title="Click-through"
            value={`${ctr}%`}
            sub="Offer clicks per 100 profile views"
            sparkData={null}
            sparkKey="clicks"
            sparkColor="#a78bfa"
          />
          <div className="flex flex-col justify-between rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-md">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Floor signal</p>
              <p className="mt-2 font-display text-lg font-semibold text-white">Crowd level</p>
              <p className="mt-1 text-xs text-slate-500">What explorers see on your pin</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {CROWD_STEPS.map(({ level, label, hint }) => {
                const active = business?.crowdLevel === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onCrowdChange?.(level)}
                    className={`rounded-xl border px-2 py-2.5 text-left text-xs font-semibold transition-all duration-200 ${
                      active
                        ? 'border-emerald-400/60 bg-emerald-500/20 text-white shadow-lg shadow-emerald-500/20'
                        : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/25 hover:bg-white/10 hover:text-slate-200'
                    }`}>
                    <span className="block text-[11px] text-slate-500">{hint}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="goout-glass-card rounded-3xl border border-white/50 p-6 shadow-xl md:p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="font-display text-lg font-bold text-slate-900 md:text-xl">30-day trajectory</h3>
            <p className="mt-1 text-sm text-slate-600">Views and deal interest over the last month</p>
          </div>
          <div className="flex flex-wrap gap-4 text-xs font-semibold">
            <span className="flex items-center gap-2 text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
              Profile views
            </span>
            <span className="flex items-center gap-2 text-sky-700">
              <span className="h-2 w-2 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.6)]" />
              Offer clicks
            </span>
          </div>
        </div>

        <div className="h-[280px] w-full md:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gradViewsArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" stroke="rgba(148, 163, 184, 0.25)" vertical={false} />
              <XAxis
                dataKey="shortDate"
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148,163,184,0.35)' }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
              <Tooltip {...CHART_TOOLTIP} />
              <Area
                type="monotone"
                dataKey="profileViews"
                name="Profile views"
                stroke="#059669"
                strokeWidth={2}
                fill="url(#gradViewsArea)"
                isAnimationActive
              />
              <Line
                type="monotone"
                dataKey="offerClicks"
                name="Offer clicks"
                stroke="#0ea5e9"
                strokeWidth={2.5}
                dot={{ r: 2, fill: '#0ea5e9', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#38bdf8', stroke: '#fff', strokeWidth: 2 }}
                isAnimationActive
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="goout-glass-card rounded-3xl border border-white/50 p-6 shadow-xl md:p-8">
        <div className="mb-6">
          <h3 className="font-display text-lg font-bold text-slate-900 md:text-xl">Visit rhythm</h3>
          <p className="mt-1 text-sm text-slate-600">Profile opens by hour of day (all-time bucket)</p>
        </div>
        {peakEntries.length === 0 ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 text-center">
            <p className="text-sm font-medium text-slate-600">No hourly data yet</p>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              As explorers open your listing, peaks will appear here so you can staff and run flash deals at the right time.
            </p>
          </div>
        ) : (
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakEntries} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
                <defs>
                  <linearGradient id="barRhythm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 8" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#64748b', fontSize: 9 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148,163,184,0.35)' }}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={52}
                />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v) => [`${v} views`, 'Hour']} />
                <Bar dataKey="count" name="Views" radius={[6, 6, 0, 0]} isAnimationActive>
                  {peakEntries.map((entry) => (
                    <Cell
                      key={`${entry.hourNum}-${entry.label}`}
                      fill="url(#barRhythm)"
                      opacity={0.45 + (entry.count / maxPeak) * 0.55}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
