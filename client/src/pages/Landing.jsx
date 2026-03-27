import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-goout-dark via-slate-900 to-goout-dark text-white font-display">
      <nav className="flex justify-between items-center px-6 md:px-12 py-6 max-w-7xl mx-auto">
        <span className="text-2xl font-bold text-goout-green tracking-tight">GoOut</span>
        <div className="flex gap-3">
          <Link to="/login" className="px-4 py-2.5 rounded-xl hover:bg-white/10 transition font-medium">Login</Link>
          <Link to="/register" className="px-5 py-2.5 bg-goout-green rounded-xl font-semibold hover:bg-goout-accent transition shadow-lg shadow-goout-green/20">Get Started</Link>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 md:px-12 py-16 md:py-24">
        <div className="max-w-2xl">
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-6 tracking-tight">
            Discover Local.<br />Explore Together.
          </h1>
          <p className="text-lg md:text-xl text-slate-300 mb-10 leading-relaxed">
            Step outside, find hidden gems, save money, and connect with people who share your interests.
            GoOut turns your city into an adventure—without the delivery fees.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link to="/register" className="px-8 py-4 bg-goout-green rounded-xl font-semibold text-lg hover:bg-goout-accent transition shadow-lg shadow-goout-green/25">
              Start Exploring
            </Link>
            <Link to="/login" className="px-8 py-4 border-2 border-slate-500 rounded-xl font-semibold text-lg hover:bg-white/5 hover:border-slate-400 transition">
              Sign In
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-20">
          <div className="bg-white/5 backdrop-blur rounded-2xl p-6 border border-white/10 hover:border-goout-green/30 transition">
            <div className="text-4xl mb-4">🗺️</div>
            <h3 className="font-semibold text-lg mb-2">Interactive Discovery Map</h3>
            <p className="text-slate-400 text-sm leading-relaxed">Geospatial map with marker clustering. Search by area when GPS is denied.</p>
          </div>
          <div className="bg-white/5 backdrop-blur rounded-2xl p-6 border border-white/10 hover:border-goout-green/30 transition">
            <div className="text-4xl mb-4">🤝</div>
            <h3 className="font-semibold text-lg mb-2">Buddy Matching</h3>
            <p className="text-slate-400 text-sm leading-relaxed">Jaccard similarity & interest broadening. SOS & Dead Man&apos;s Switch.</p>
          </div>
          <div className="bg-white/5 backdrop-blur rounded-2xl p-6 border border-white/10 hover:border-goout-green/30 transition">
            <div className="text-4xl mb-4">🌿</div>
            <h3 className="font-semibold text-lg mb-2">Green Mode</h3>
            <p className="text-slate-400 text-sm leading-relaxed">Calories = Distance × 0.75 × Weight. Velocity check prevents fraud.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
