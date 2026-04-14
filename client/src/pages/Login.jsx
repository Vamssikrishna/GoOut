import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('credentials');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { login, verifyLoginOtp } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const handleCredentials = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result?.requiresOtp) {
        setStep('otp');
        setOtp('');
        addToast({
          type: 'success',
          title: 'Check your email',
          message: result.message || 'We sent a sign-in code to your inbox.'
        });
        return;
      }
      addToast({ type: 'success', title: 'Logged in', message: 'Welcome back!' });
      navigate('/app');
    } catch (res) {
      setErr(res.response?.data?.error || 'Login failed');
      addToast({
        type: 'error',
        title: 'Login failed',
        message: res.response?.data?.error || 'Please check your credentials.'
      });
    } finally {
      setBusy(false);
    }
  };

  const handleOtp = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await verifyLoginOtp(email, otp.replace(/\D/g, '').slice(0, 6));
      addToast({ type: 'success', title: 'Logged in', message: 'Welcome back!' });
      navigate('/app');
    } catch (res) {
      setErr(res.response?.data?.error || 'Verification failed');
      addToast({
        type: 'error',
        title: 'Could not verify',
        message: res.response?.data?.error || 'Check the code and try again.'
      });
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setErr('');
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result?.requiresOtp) {
        addToast({ type: 'success', title: 'Code sent', message: 'We sent a new sign-in code.' });
      }
    } catch (res) {
      setErr(res.response?.data?.error || 'Could not resend');
      addToast({
        type: 'error',
        title: 'Could not resend',
        message: res.response?.data?.error || 'Try again.'
      });
    } finally {
      setBusy(false);
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
        <div className="goout-glass-card rounded-2xl p-8 shadow-xl border border-white/60">
          {step === 'credentials' ?
          <>
              <h1 className="text-2xl font-bold text-slate-900 mb-6">Welcome back</h1>
              <form onSubmit={handleCredentials} className="space-y-4">
                {err && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{err}</div>}
                <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent" />
              
                <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent" />
              
                <div className="flex justify-end">
                  <Link to="/forgot-password" className="text-sm text-goout-green font-medium hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <button type="submit" disabled={busy} className="goout-btn-primary w-full py-3 rounded-xl justify-center">
                  {busy ? 'Please wait…' : 'Sign In'}
                </button>
              </form>
              <p className="mt-6 text-center text-slate-600 text-sm">
                Don&apos;t have an account?{' '}
                <Link to="/register" className="text-goout-green font-medium hover:underline">
                  Register
                </Link>
              </p>
            </> :

          <>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Enter sign-in code</h1>
              <p className="text-slate-600 text-sm mb-6">
                We sent a 6-digit code to <span className="font-medium text-slate-800">{email}</span>.
              </p>
              <form onSubmit={handleOtp} className="space-y-4">
                {err && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{err}</div>}
                <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoComplete="one-time-code"
                className="w-full px-4 py-3 rounded-lg border border-slate-200 text-center text-2xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-goout-green focus:border-transparent" />
              
                <button
                type="submit"
                disabled={busy || otp.length !== 6}
                className="goout-btn-primary w-full py-3 rounded-xl justify-center disabled:opacity-60">
                  {busy ? 'Verifying…' : 'Verify & continue'}
                </button>
              </form>
              <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-between items-center text-sm">
                <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setErr('');
                  setOtp('');
                }}
                className="text-slate-600 hover:text-slate-900">
                
                  ← Back
                </button>
                <button
                type="button"
                onClick={handleResend}
                disabled={busy}
                className="text-goout-green font-medium hover:underline disabled:opacity-60">
                
                  Resend code
                </button>
              </div>
            </>
          }
        </div>
      </div>
    </div>);

}