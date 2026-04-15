import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('explorer');
  const [interests, setInterests] = useState('');
  const [preferences, setPreferences] = useState('');
  const [avoid, setAvoid] = useState('');
  const [err, setErr] = useState('');
  const [step, setStep] = useState(1);
  const { register } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    
    if (step === 1) {
      setStep(2);
      return;
    }

    try {
      await register(name, email, password, role);
      
      // Save preferences if explorer
      if (role === 'explorer') {
        try {
          await api.put('/users/discovery-preferences', {
            prefer: preferences.split(',').map((s) => s.trim()).filter(Boolean),
            avoid: avoid.split(',').map((s) => s.trim()).filter(Boolean),
            notes: ''
          });
        } catch (prefErr) {
          console.error('Could not save preferences:', prefErr);
        }
        
        // Save interests
        try {
          await api.put('/users/profile', {
            interests: interests.split(',').map((s) => s.trim()).filter(Boolean)
          });
        } catch (interestErr) {
          console.error('Could not save interests:', interestErr);
        }
      }
      
      addToast({ type: 'success', title: 'Account created', message: 'Welcome to GoOut! Complete your profile to get better matches.' });
      navigate('/app/profile');
    } catch (res) {
      setErr(res.response?.data?.error || 'Registration failed');
      addToast({ type: 'error', title: 'Registration failed', message: res.response?.data?.error || 'Please try again.' });
    }
  };

  return (
    <div className="min-h-screen goout-auth-shell flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-md goout-animate-in">
        <Link
          to="/"
          className="block font-display font-extrabold text-3xl mb-8 bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent hover:opacity-90 transition-opacity w-fit">
          GoOut
        </Link>
        <div className="goout-glass-card goout-neon-panel rounded-2xl p-8 shadow-xl border border-white/60">
          <h1 className="text-2xl font-bold text-slate-900 mb-6">{step === 1 ? 'Create account' : 'Set your preferences'}</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            {err && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{err}</div>}
            
            {step === 1 ? (
              <>
                <input type="text" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent goout-neon-input" />
                <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent goout-neon-input" />
                <input type="password" placeholder="Password (min 6 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent goout-neon-input" />
                <div>
                  <label className="block text-sm text-slate-600 mb-1">I am a</label>
                  <select value={role} onChange={(e) => setRole(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green goout-neon-input">
                    <option value="explorer">Explorer (find places & buddies)</option>
                    <option value="merchant">Merchant (local business owner)</option>
                  </select>
                </div>
                <button type="submit" className="goout-btn-primary w-full py-3 rounded-xl justify-center">
                  Next
                </button>
              </>
            ) : role === 'explorer' ? (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-blue-900 font-medium">Tell us about your buddy preferences so we can match you with the right explorers and groups!</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Your interests (comma-separated)</label>
                  <input type="text" placeholder="hiking, coffee, books, cycling, art..." value={interests} onChange={(e) => setInterests(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green goout-neon-input"
                    maxLength="200" />
                  <p className="text-xs text-slate-500 mt-1">Help us find activity buddies with similar interests</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">What activities do you prefer? (comma-separated)</label>
                  <input type="text" placeholder="outdoor adventures, casual hangouts, learning activities..." value={preferences} onChange={(e) => setPreferences(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green goout-neon-input"
                    maxLength="300" />
                  <p className="text-xs text-slate-500 mt-1">This helps our AI suggest matching groups and buddies</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">What you'd like to avoid (comma-separated, optional)</label>
                  <input type="text" placeholder="loud places, crowded venues, late nights..." value={avoid} onChange={(e) => setAvoid(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green goout-neon-input"
                    maxLength="300" />
                  <p className="text-xs text-slate-500 mt-1">We'll filter out activities that don't match your preferences</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep(1)} className="flex-1 px-4 py-3 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50">
                    Back
                  </button>
                  <button type="submit" className="flex-1 goout-btn-primary py-3 rounded-lg justify-center">
                    Create Account
                  </button>
                </div>
              </>
            ) : (
              <>
                <button type="submit" className="goout-btn-primary w-full py-3 rounded-xl justify-center">
                  Complete Registration
                </button>
              </>
            )}
          </form>
          <p className="mt-6 text-center text-slate-600 text-sm">
            Already have an account? <Link to="/login" className="text-goout-green font-medium hover:underline">Login</Link>
          </p>
        </div>
      </div>
    </div>);

}