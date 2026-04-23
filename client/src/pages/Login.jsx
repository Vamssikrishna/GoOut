import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const OTP_WINDOW_SECONDS = 30;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const location = useLocation();
  const [email, setEmail] = useState(String(location.state?.prefillEmail || ''));
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('credentials');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(OTP_WINDOW_SECONDS);
  const { login, verifyLoginOtp } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const normalizedEmail = email.trim();
  const isEmailInvalid = normalizedEmail.length > 0 && !emailPattern.test(normalizedEmail);
  const isOtpExpired = otpSecondsLeft <= 0;
  const otpCountdownLabel = `00:${String(otpSecondsLeft).padStart(2, '0')}`;

  useEffect(() => {
    if (step !== 'otp' || isOtpExpired) return undefined;
    const timer = setInterval(() => {
      setOtpSecondsLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, isOtpExpired]);

  const handleCredentials = async (e) => {
    e.preventDefault();
    const cleanedEmail = email.trim();
    if (!emailPattern.test(cleanedEmail)) {
      setErr('Enter a valid email address.');
      return;
    }
    setEmail(cleanedEmail);
    setErr('');
    setBusy(true);
    try {
      const result = await login(cleanedEmail, password);
      if (result?.requiresOtp) {
        setStep('otp');
        setOtp('');
        setOtpSecondsLeft(OTP_WINDOW_SECONDS);
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
    if (isOtpExpired) {
      setErr('Code expired. Tap "Send OTP again" to get a new code.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await verifyLoginOtp(email.trim(), otp.replace(/\D/g, '').slice(0, 6));
      addToast({ type: 'success', title: 'Logged in', message: 'Welcome back!' });
      navigate('/app');
    } catch (res) {
      const message = res.response?.data?.error || 'Verification failed';
      setErr(message);
      if (message.toLowerCase().includes('expired')) {
        setOtpSecondsLeft(0);
      }
      addToast({
        type: 'error',
        title: 'Could not verify',
        message: message || 'Check the code and try again.'
      });
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setErr('');
    setBusy(true);
    try {
      const result = await login(email.trim(), password);
      if (result?.requiresOtp) {
        setOtp('');
        setOtpSecondsLeft(OTP_WINDOW_SECONDS);
        setErr('');
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
      <div className="w-full max-w-2xl goout-animate-in">
        <Link
          to="/"
          className="block font-display font-extrabold text-3xl mb-8 bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent hover:opacity-90 transition-opacity w-fit">
          GoOut
        </Link>
        <div className="goout-glass-card goout-neon-panel goout-auth-panel rounded-3xl p-8 sm:p-9 shadow-md border border-slate-200">
          {step === 'credentials' ?
          <>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Welcome back</h1>
              <p className="mt-2 mb-7 text-sm text-slate-600 leading-relaxed">Sign in to sync your map, buddies, and deals.</p>
              <form onSubmit={handleCredentials} className="space-y-4">
                {err && <div className="p-3 rounded-lg text-sm border border-red-300/50 bg-red-500/15 text-red-100">{err}</div>}
                <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent goout-neon-input" />
                {isEmailInvalid && <p className="text-xs text-red-600 -mt-2">Enter a valid email address.</p>}
              
                <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent goout-neon-input" />
              
                <div className="flex justify-end">
                  <Link to="/forgot-password" className="text-sm text-goout-green font-medium hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <button
                type="submit"
                disabled={busy || isEmailInvalid}
                className="goout-btn-primary w-full py-3 rounded-xl justify-center disabled:opacity-60">
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
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">Enter sign-in code</h1>
              <p className="text-slate-600 text-sm mb-6">
                We sent a 6-digit code to <span className="font-medium text-slate-800">{email}</span>.
              </p>
              <p className={`text-xs mb-4 font-mono ${isOtpExpired ? 'text-amber-600' : 'text-slate-500'}`}>
                {isOtpExpired ? 'Code expired.' : `Time left: ${otpCountdownLabel}`}
              </p>
              <form onSubmit={handleOtp} className="space-y-4">
                {err && <div className="p-3 rounded-lg text-sm border border-red-300/50 bg-red-500/15 text-red-100">{err}</div>}
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
                className="w-full px-4 py-3 rounded-lg border border-slate-200 text-center text-2xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-goout-green focus:border-transparent goout-neon-input" />
              
                <button
                type="submit"
                disabled={busy || otp.length !== 6 || isOtpExpired}
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
                {isOtpExpired ?
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={busy || isEmailInvalid}
                  className="text-goout-green font-medium hover:underline disabled:opacity-60">

                    Send OTP again
                  </button> :
                <span className="text-slate-500 font-mono">
                    Send OTP again in {otpCountdownLabel}
                  </span>
                }
              </div>
            </>
          }
        </div>
      </div>
    </div>);

}