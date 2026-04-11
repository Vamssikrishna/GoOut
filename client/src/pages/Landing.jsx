import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-screen goout-page-shell text-slate-900 font-display">
      <nav className="flex justify-between items-center px-6 md:px-12 py-6 max-w-7xl mx-auto">
        <span className="text-2xl font-bold text-goout-green tracking-tight">GoOut</span>
        <div className="flex gap-3">
          <Link to="/login" className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white/90 hover:bg-white transition font-medium">Login</Link>
          <Link to="/register" className="px-5 py-2.5 bg-goout-green rounded-xl font-semibold hover:bg-goout-accent transition shadow-lg shadow-goout-green/20">Get Started</Link>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 md:px-12 py-16 md:py-24">
        <div className="max-w-2xl">
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-6 tracking-tight">
            Discover Local.<br />Explore Together.
          </h1>
          <p className="text-lg md:text-xl text-slate-600 mb-10 leading-relaxed">
            Step outside, find hidden gems, save money, and connect with people who share your interests.
            GoOut transforms local discovery into a precise, real-time city experience.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link to="/register" className="px-8 py-4 bg-goout-green rounded-xl font-semibold text-lg hover:bg-goout-accent transition shadow-lg shadow-goout-green/25">
              Start Exploring
            </Link>
            <Link to="/login" className="px-8 py-4 border-2 border-slate-300 rounded-xl font-semibold text-lg hover:bg-white hover:border-slate-400 transition">
              Sign In
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-20">
          <div className="goout-surface rounded-2xl p-6 hover:border-goout-green/40 transition">
            <h3 className="font-semibold text-lg mb-2">Precision Discovery Map</h3>
            <p className="text-slate-400 text-sm leading-relaxed">High-accuracy location, local-first discovery, and fast geospatial search tuned for real usage.</p>
          </div>
          <div className="goout-surface rounded-2xl p-6 hover:border-goout-green/40 transition">
            <h3 className="font-semibold text-lg mb-2">Professional Group Coordination</h3>
            <p className="text-slate-400 text-sm leading-relaxed">Create meetups, manage requests, and use integrated safety checkpoints for trusted outings.</p>
          </div>
          <div className="goout-surface rounded-2xl p-6 hover:border-goout-green/40 transition">
            <h3 className="font-semibold text-lg mb-2">Smart Behavioral Guidance</h3>
            <p className="text-slate-400 text-sm leading-relaxed">RAG-powered concierge, live flash deals, and walk-first nudges to reduce delivery dependency.</p>
          </div>
        </div>
      </main>
    </div>);

}