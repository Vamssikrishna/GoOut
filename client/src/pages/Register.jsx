import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

function EyeIcon({ open = false, className = '' }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="4" y1="20" x2="20" y2="4" />
    </svg>
  );
}

export default function Register() {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const passwordPolicy = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('explorer');
  const [interests, setInterests] = useState('');
  const [preferences, setPreferences] = useState('');
  const [avoid, setAvoid] = useState('');
  const [err, setErr] = useState('');
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const { register } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const normalizedEmail = email.trim();
  const isEmailInvalid = normalizedEmail.length > 0 && !emailPattern.test(normalizedEmail);
  const isPasswordInvalid = password.length > 0 && !passwordPolicy.test(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    
    if (step === 1) {
      if (!emailPattern.test(normalizedEmail)) {
        setErr('Enter a valid email address.');
        return;
      }
      if (!passwordPolicy.test(password)) {
        setErr('Password must include at least 6 characters, 1 uppercase letter, 1 number, and 1 special symbol.');
        return;
      }
      setEmail(normalizedEmail);
      setStep(2);
      return;
    }

    try {
      const preferList = preferences.split(',').map((s) => s.trim()).filter(Boolean);
      if (role === 'explorer' && preferList.length === 0) {
        setErr('Please enter at least one preference to continue.');
        return;
      }
      await register({
        name,
        email: normalizedEmail,
        password,
        role,
        interests: interests.split(',').map((s) => s.trim()).filter(Boolean),
        prefer: preferList,
        avoid: avoid.split(',').map((s) => s.trim()).filter(Boolean),
        notes: ''
      });
      addToast({ type: 'success', title: 'Account created', message: 'Now sign in — we will email your OTP code.' });
      navigate('/login', { state: { prefillEmail: normalizedEmail } });
    } catch (res) {
      setErr(res.response?.data?.error || 'Registration failed');
      addToast({ type: 'error', title: 'Registration failed', message: res.response?.data?.error || 'Please try again.' });
    }
  };

  return (
    <div className="min-h-screen goout-auth-shell flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-2xl goout-animate-in">
        <Link
          to="/"
          className="block font-display font-extrabold text-3xl mb-8 bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent hover:opacity-90 transition-opacity w-fit">
          GoOut
        </Link>
        <div className="goout-glass-card goout-neon-panel goout-auth-panel rounded-3xl p-8 sm:p-9 shadow-md border border-slate-200">
          <div className="flex items-center gap-2 mb-6" aria-hidden>
            <span className={`h-1.5 flex-1 rounded-full ${step === 1 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-emerald-200'}`} />
            <span className={`h-1.5 flex-1 rounded-full ${step === 2 ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-slate-200'}`} />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-600/90 mb-2">Step {step} of 2</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-6">
            {step === 1 ? 'Create account' : 'Set your preferences'}
          </h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            {err && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium leading-relaxed text-red-700 break-words">
                {err}
              </div>
            )}
            
            {step === 1 ? (
              <>
                <input type="text" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent goout-neon-input" />
                <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent goout-neon-input" />
                {isEmailInvalid && <p className="text-xs text-red-600 -mt-2">Enter a valid email address.</p>}
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} placeholder="Password (6+ chars, A-Z, 0-9, symbol)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                    title="At least 6 characters, 1 uppercase letter, 1 number, and 1 special symbol"
                    className="w-full px-4 py-3 pr-11 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent goout-neon-input" />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <EyeIcon open={showPassword} className="h-4 w-4" />
                  </button>
                </div>
                {isPasswordInvalid && (
                  <p className="text-xs text-red-600 -mt-2">
                    Use at least 6 characters with 1 uppercase letter, 1 number, and 1 special symbol.
                  </p>
                )}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">I am a</label>
                  <select value={role} onChange={(e) => setRole(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green goout-neon-input">
                    <option value="explorer">Explorer (find places & buddies)</option>
                    <option value="merchant">Merchant (local business owner)</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={isEmailInvalid}
                  className="goout-btn-primary w-full py-3 rounded-xl justify-center disabled:opacity-60">
                  Next
                </button>
              </>
            ) : role === 'explorer' ? (
              <>
                <div className="rounded-lg border border-emerald-300/40 bg-emerald-500/15 p-3 mb-4">
                  <p className="text-xs text-emerald-100 font-medium">Tell us about your buddy preferences so we can match you with the right explorers and groups!</p>
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
                    required
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
                  <button type="button" onClick={() => setStep(1)} className="flex-1 goout-btn-ghost py-3 rounded-lg">
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