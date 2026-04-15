import { Link } from 'react-router-dom';

const features = [
  {
    title: 'Precision discovery map',
    body: 'High-accuracy GPS, local-first ranking, and geospatial search tuned for real walks—not generic lists.',
    accent: 'from-emerald-500/20 to-teal-500/10'
  },
  {
    title: 'Group coordination',
    body: 'Meetups, invites, and safety-aware routing so plans feel organized instead of chaotic.',
    accent: 'from-sky-500/20 to-violet-500/10'
  },
  {
    title: 'Concierge & deals',
    body: 'Personalized chips, flash deals, and walk-first nudges that respect your budget and vibe.',
    accent: 'from-violet-500/20 to-emerald-500/10'
  }
];

export default function Landing() {
  return (
    <div className="goout-app-mesh relative min-h-screen overflow-x-hidden font-display text-slate-900 goout-page-shell">
      <div className="goout-hero-orb w-[min(90vw,28rem)] h-[min(90vw,28rem)] -top-24 -left-24 bg-emerald-400/40 animate-float-slow" />
      <div className="goout-hero-orb w-[min(70vw,22rem)] h-[min(70vw,22rem)] top-32 -right-16 bg-sky-400/35 animate-float-delayed" />
      <div className="goout-hero-orb w-[min(50vw,16rem)] h-[min(50vw,16rem)] bottom-20 left-1/3 bg-violet-400/25 animate-pulse-soft" />

      <nav className="relative flex justify-between items-center px-6 md:px-12 py-6 max-w-7xl mx-auto z-10 animate-fade-in">
        <span className="goout-brand-link text-2xl font-extrabold tracking-tight md:text-3xl">GoOut</span>
        <div className="flex gap-2 sm:gap-3 goout-neon-panel rounded-2xl p-1.5">
          <Link
            to="/login"
            className="goout-link-landing border border-cyan-200/80 bg-white/70 text-slate-700 backdrop-blur transition-shadow duration-300 hover:border-cyan-300/70 hover:bg-white hover:shadow-md hover:shadow-cyan-500/15">
            Login
          </Link>
          <Link
            to="/register"
            className="goout-link-landing bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 transition-shadow duration-300 hover:shadow-xl hover:shadow-emerald-500/45">
            Get started
          </Link>
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 pb-24">
        <section className="pt-8 md:pt-16 lg:pt-20 lg:flex lg:items-end lg:justify-between gap-12">
          <div className="max-w-2xl goout-animate-stagger">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600/90 mb-4">Hyper-local · Social</p>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold leading-[1.05] mb-6 tracking-tight text-slate-900">
              Discover local.
              <br />
              <span className="bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-600 bg-clip-text text-transparent">
                Explore together.
              </span>
            </h1>
            <p className="text-lg md:text-xl text-slate-600 mb-10 leading-relaxed max-w-xl">
              Step outside, find hidden gems, save money, and connect with people who share your interests—without losing
              the thread of where you actually are.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to="/register"
                className="goout-link-landing px-8 py-4 text-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-xl shadow-emerald-500/30 hover:shadow-emerald-500/45 rounded-2xl">
                Start exploring
              </Link>
              <Link
                to="/login"
                className="goout-link-landing px-8 py-4 text-lg border-2 border-slate-200/90 bg-white/60 backdrop-blur text-slate-800 hover:border-emerald-300/70 rounded-2xl">
                Sign in
              </Link>
            </div>
          </div>
          <div className="hidden lg:block flex-1 max-w-md mb-4 animate-slide-up opacity-0 [animation-delay:200ms]">
            <div className="goout-glass-card goout-neon-panel rounded-3xl p-8 goout-hover-lift border border-white/60">
              <div className="h-2 w-24 rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 mb-6" />
              <p className="text-slate-500 text-sm leading-relaxed mb-4">Live map · buddies · flash deals</p>
              <div className="space-y-3">
                {[1, 2, 3].map((i) =>
                <div
                  key={i}
                  className="h-3 rounded-full bg-slate-200/80 animate-pulse"
                  style={{ width: `${100 - i * 18}%`, animationDelay: `${i * 0.15}s` }} />

                )}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-20 md:mt-28 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {features.map((f, i) =>
          <article
            key={f.title}
            className={`goout-glass-card rounded-2xl p-6 md:p-7 goout-hover-lift group cursor-default border border-white/50 animate-slide-up opacity-0`}
            style={{ animationDelay: `${120 + i * 80}ms`, animationFillMode: 'forwards' }}>
            
              <div
              className={`h-1.5 w-12 rounded-full mb-5 bg-gradient-to-r ${f.accent} group-hover:w-20 transition-all duration-500 ease-out`}
            />
              <h3 className="font-bold text-lg mb-2 text-slate-900 group-hover:text-emerald-800 transition-colors">{f.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed">{f.body}</p>
            </article>
          )}
        </section>
      </main>
    </div>);

}
