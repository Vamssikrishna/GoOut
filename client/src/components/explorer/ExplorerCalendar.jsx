import { useEffect, useMemo, useState } from 'react';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthLabel(monthDate) {
  return monthDate.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function toDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeDateKey(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return toDateKey(dt);
}

function formatSchedule(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'Time not set';
  return dt.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function buildMonthCells(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay();
  const monthDays = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const cells = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    const day = prevMonthDays - firstWeekday + i + 1;
    const dt = new Date(year, month - 1, day);
    cells.push({ key: `pad-start-${i}`, inMonth: false, day, dateKey: toDateKey(dt) });
  }
  for (let day = 1; day <= monthDays; day += 1) {
    const dt = new Date(year, month, day);
    cells.push({ key: `day-${day}`, inMonth: true, day, dateKey: toDateKey(dt) });
  }
  while (cells.length % 7 !== 0) {
    const day = cells.length - (firstWeekday + monthDays) + 1;
    const dt = new Date(year, month + 1, day);
    const i = cells.length;
    cells.push({ key: `pad-end-${i}`, inMonth: false, day, dateKey: toDateKey(dt) });
  }
  return cells;
}

function statusPill(status) {
  const t = String(status || '').toLowerCase();
  if (t === 'completed') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (t === 'ongoing') return 'bg-slate-100 text-slate-800 border-slate-200';
  if (t === 'full') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (t === 'pending') return 'bg-sky-100 text-sky-800 border-sky-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

export default function ExplorerCalendar({
  plans = [],
  loading = false,
  error = '',
  onRefresh,
  onOpenPlanMap
}) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDateKey, setSelectedDateKey] = useState(() => normalizeDateKey(new Date()));

  const plansByDate = useMemo(() => {
    const m = new Map();
    for (const p of plans) {
      const k = normalizeDateKey(p.scheduledAt);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    for (const [k, list] of m.entries()) {
      m.set(k, [...list].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)));
    }
    return m;
  }, [plans]);

  const monthCells = useMemo(() => buildMonthCells(monthCursor), [monthCursor]);
  const selectedPlans = plansByDate.get(selectedDateKey) || [];
  const todayKey = useMemo(() => normalizeDateKey(new Date()), []);
  const monthPlanCount = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    return plans.filter((p) => {
      const dt = new Date(p.scheduledAt);
      return !Number.isNaN(dt.getTime()) && dt.getFullYear() === year && dt.getMonth() === month;
    }).length;
  }, [plans, monthCursor]);

  useEffect(() => {
    if (!Array.isArray(plans) || plans.length === 0) return;
    const upcomingOrFirst = [...plans]
      .map((p) => {
        const ts = new Date(p?.scheduledAt).getTime();
        return Number.isFinite(ts) ? { p, ts } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);
    if (!upcomingOrFirst.length) return;

    const now = Date.now();
    const target =
      upcomingOrFirst.find((entry) => entry.ts >= now) ||
      upcomingOrFirst[0];
    const targetDate = new Date(target.ts);
    const targetKey = toDateKey(targetDate);

    setMonthCursor(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
    setSelectedDateKey(targetKey);
  }, [plans]);

  return (
    <div className="space-y-4">
      <div className="goout-glass-card rounded-2xl border border-slate-200/80 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-slate-900">Buddy Calendar</h3>
            <p className="text-xs text-slate-600 mt-1">
              Buddy meetups sync here. Monthly plans: <span className="font-semibold">{monthPlanCount}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50">
              ←
            </button>
            <div className="min-w-[11rem] text-center text-sm font-semibold text-slate-800">{monthLabel(monthCursor)}</div>
            <button
              type="button"
              onClick={() => setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50">
              →
            </button>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="ml-1 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-medium hover:bg-emerald-100">
                Refresh
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr,1fr]">
        <div className="goout-surface rounded-2xl border border-slate-200 p-4">
          <div className="grid grid-cols-7 gap-2">
            {WEEK_DAYS.map((d) => (
              <div key={d} className="text-[11px] font-bold uppercase tracking-wide text-slate-500 text-center">
                {d}
              </div>
            ))}
            {monthCells.map((cell) => {
              const count = cell.inMonth ? (plansByDate.get(cell.dateKey)?.length || 0) : 0;
              const active = cell.inMonth && selectedDateKey === cell.dateKey;
              const isToday = cell.inMonth && cell.dateKey === todayKey;
              return (
                <button
                  key={cell.key}
                  type="button"
                  disabled={!cell.inMonth}
                  onClick={() => cell.inMonth && setSelectedDateKey(cell.dateKey)}
                  className={`min-h-[68px] rounded-xl border text-left p-2 transition ${
                    !cell.inMonth ?
                      'border-slate-200/70 bg-slate-50/60 cursor-default' :
                      active ?
                        'border-indigo-300/80 bg-indigo-500/20 shadow-sm' :
                        isToday ?
                          'border-cyan-300/70 bg-cyan-500/10' :
                        'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
                  }`}>
                  <>
                    <div
                      className={`text-sm font-semibold ${
                        active ? 'text-cyan-100' :
                          isToday ? 'text-cyan-200' :
                            cell.inMonth ? 'text-slate-900' : 'text-slate-500'
                      }`}>
                      {cell.day}
                    </div>
                    {count > 0 && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-goout-green/10 px-2 py-0.5 text-[11px] font-medium text-goout-green">
                        <span className="h-1.5 w-1.5 rounded-full bg-goout-green" />
                        {count} plan{count > 1 ? 's' : ''}
                      </div>
                    )}
                  </>
                </button>
              );
            })}
          </div>
        </div>

        <div className="goout-surface rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <h4 className="font-display font-semibold text-slate-900">Plans on {selectedDateKey || 'selected day'}</h4>
            {loading && <span className="text-xs text-slate-500">Syncing…</span>}
          </div>
          {error ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          ) : selectedPlans.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
              No buddy meetings for this date.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {selectedPlans.map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{p.title}</p>
                      <p className="text-xs text-slate-500 mt-1">{formatSchedule(p.scheduledAt)}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${statusPill(p.status)}`}>
                      {p.status || 'open'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-2">
                    Venue: <span className="font-medium text-slate-800">{p.venueName || 'TBD'}</span>
                  </p>
                  {p.roleLabel ? <p className="text-[11px] text-slate-500 mt-1">Role: {p.roleLabel}</p> : null}
                  {onOpenPlanMap && Number.isFinite(p.lat) && Number.isFinite(p.lng) && (
                    <button
                      type="button"
                      onClick={() => onOpenPlanMap(p)}
                      className="mt-2 px-2.5 py-1.5 rounded-lg bg-goout-green text-white text-xs font-medium hover:bg-goout-accent">
                      Open on map
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
