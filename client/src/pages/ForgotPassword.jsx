import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { addToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
      addToast({
        type: 'success',
        title: 'Check your inbox',
        message: 'If that email is registered, we sent reset instructions.'
      });
    } catch (res) {
      const message = res.response?.data?.error || 'Try again later.';
      setErr(message);
      addToast({
        type: 'error',
        title: 'Something went wrong',
        message
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
          <div className="hidden bg-gradient-to-br from-orange-500 to-emerald-500 p-8 text-white md:col-span-2 md:flex md:flex-col md:justify-between">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.32em] text-white/75">Account recovery</p>
              <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight">Get back to your plans quickly.</h2>
            </div>
            <p className="text-sm leading-relaxed text-white/85">We will send a secure reset link if the email belongs to your GoOut account.</p>
          </div>
        <div className="p-8 md:col-span-3">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Forgot password</h1>
          <p className="text-slate-600 text-sm mb-6">
            Enter your account email. If it&apos;s registered, we&apos;ll send a link to choose a new password.
          </p>
          {err && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium leading-relaxed text-red-700 break-words">
              {err}
            </div>
          )}
          {sent ?
          <p className="text-slate-700 text-sm">
              If <span className="font-medium">{email}</span> is registered, look for an email with a reset link. It
              expires in one hour.
            </p> :

          <form onSubmit={handleSubmit} className="space-y-4">
              <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent" />
            
              <button type="submit" disabled={busy} className="goout-btn-primary w-full py-3 rounded-xl justify-center">
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          }
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