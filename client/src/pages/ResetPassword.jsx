import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { addToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (password.length < 6) {
      setErr('Password must be at least 6 characters.');
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
      <div className="w-full max-w-3xl goout-animate-in">
        <Link
          to="/"
          className="block font-display font-extrabold text-3xl mb-8 bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent w-fit">
          GoOut
        </Link>
        <div className="goout-glass-card rounded-2xl p-8 shadow-md border border-slate-200">
          <h1 className="text-2xl font-bold text-slate-900 mb-6">Set a new password</h1>
          {!token &&
          <p className="text-amber-700 text-sm mb-4">
              No token in the URL. Use the link from your reset email, or request a new one from forgot password.
            </p>
          }
          <form onSubmit={handleSubmit} className="space-y-4">
            {err && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{err}</div>}
            <input
              type="password"
              placeholder="New password (min 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent" />
            
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent" />
            
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
    </div>);

}