import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
      addToast({
        type: 'success',
        title: 'Check your inbox',
        message: 'If that email is registered, we sent reset instructions.',
      });
    } catch (res) {
      addToast({
        type: 'error',
        title: 'Something went wrong',
        message: res.response?.data?.error || 'Try again later.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-goout-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="block text-goout-green font-display font-bold text-2xl mb-8">GoOut</Link>
        <div className="bg-white rounded-2xl p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Forgot password</h1>
          <p className="text-slate-600 text-sm mb-6">
            Enter your account email. If it&apos;s registered, we&apos;ll send a link to choose a new password.
          </p>
          {sent ? (
            <p className="text-slate-700 text-sm">
              If <span className="font-medium">{email}</span> is registered, look for an email with a reset link. It
              expires in one hour.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 bg-goout-green text-white font-medium rounded-lg hover:bg-goout-accent transition disabled:opacity-60"
              >
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
          <p className="mt-6 text-center text-slate-600 text-sm">
            <Link to="/login" className="text-goout-green font-medium hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
