export default function PageLoader({ message = 'Establishing secure session', hint }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="goout-load-screen goout-page-shell relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6"
    >
      <div className="goout-load-aurora pointer-events-none" aria-hidden />
      <div className="goout-load-grid pointer-events-none" aria-hidden />
      <div className="goout-load-scan pointer-events-none" aria-hidden />

      <div className="relative z-10 flex flex-col items-center gap-8 motion-safe:goout-animate-in">
        <div className="relative h-28 w-28">
          <div className="goout-orbit goout-orbit--outer" />
          <div className="goout-orbit goout-orbit--inner" />
          <div className="goout-orbit-core" />
        </div>
        <div className="max-w-sm space-y-3 text-center goout-neon-panel rounded-2xl px-6 py-5">
          <p className="goout-load-title font-display text-lg font-bold tracking-wide text-slate-800">{message}</p>
          {hint ? <p className="text-sm text-slate-500">{hint}</p> : null}
          <div className="goout-load-bar mx-auto max-w-[220px]">
            <div className="goout-load-bar-fill" />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-emerald-600/70">GoOut · sync</p>
        </div>
      </div>
    </div>
  );
}
