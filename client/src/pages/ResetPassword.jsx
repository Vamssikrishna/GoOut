import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';
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

export default function ResetPassword() {
  const passwordPolicy = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { addToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!passwordPolicy.test(password)) {
      setErr('Password must include at least 6 characters, 1 uppercase letter, 1 number, and 1 special symbol.');
      return;
    }
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    if (!token) {
      setErr('Missing reset token. Open the link from your email.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      addToast({ type: 'success', title: 'Password updated', message: 'You can sign in now.' });
      navigate('/login');
    } catch (res) {
      setErr(res.response?.data?.error || 'Reset failed');
      addToast({
        type: 'error',
        title: 'Could not reset',
        message: res.response?.data?.error || 'Try requesting a new link.'
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen goout-auth-shell flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-5xl goout-animate-in">
        <Link
          to="/"
          className="block font-display font-extrabold text-3xl mb-8 bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent w-fit">
          GoOut
        </Link>
        <div className="grid overflow-hidden rounded-[2rem] border border-orange-100 bg-white shadow-2xl shadow-orange-950/10 md:grid-cols-5">
          <div className="hidden bg-gradient-to-br from-slate-950 via-orange-600 to-emerald-600 p-8 text-white md:col-span-2 md:flex md:flex-col md:justify-between">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.32em] text-white/75">Secure reset</p>
              <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight">Create a stronger key for your GoOut account.</h2>
            </div>
            <p className="text-sm leading-relaxed text-white/85">Use a password with an uppercase letter, number, and symbol to protect your plans.</p>
          </div>
        <div className="p-8 md:col-span-3">
          <h1 className="text-2xl font-bold text-slate-900 mb-6">Set a new password</h1>
          {!token &&
          <p className="text-amber-700 text-sm mb-4">
              No token in the URL. Use the link from your reset email, or request a new one from forgot password.
            </p>
          }
          <form onSubmit={handleSubmit} className="space-y-4">
            {err && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{err}</div>}
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="New password (6+ chars, A-Z, 0-9, symbol)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                title="At least 6 characters, 1 uppercase letter, 1 number, and 1 special symbol"
                autoComplete="new-password"
                className="w-full px-4 py-3 pr-11 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <EyeIcon open={showPassword} className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 -mt-2">
              Use at least 6 characters with 1 uppercase letter, 1 number, and 1 special symbol.
            </p>
            
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-3 pr-11 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <EyeIcon open={showConfirm} className="h-4 w-4" />
              </button>
            </div>
            
            <button type="submit" disabled={busy || !token} className="goout-btn-primary w-full py-3 rounded-xl justify-center">
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
          <p className="mt-6 text-center text-slate-600 text-sm">
            <Link to="/login" className="text-goout-green font-medium hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
        </div>
      </div>
    </div>);

}