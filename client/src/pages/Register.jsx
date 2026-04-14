import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('explorer');
  const [err, setErr] = useState('');
  const { register } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await register(name, email, password, role);
      addToast({ type: 'success', title: 'Account created', message: 'You can now register your business if you chose merchant.' });
      navigate('/app');
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
        <div className="goout-glass-card rounded-2xl p-8 shadow-xl border border-white/60">
          <h1 className="text-2xl font-bold text-slate-900 mb-6">Create account</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            {err && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{err}</div>}
            <input type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required
            className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent" />
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required
            className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent" />
            <input type="password" placeholder="Password (min 6 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green focus:border-transparent" />
            <div>
              <label className="block text-sm text-slate-600 mb-1">I am a</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-goout-green">
                <option value="explorer">Explorer (find places & buddies)</option>
                <option value="merchant">Merchant (local business owner)</option>
              </select>
            </div>
            <button type="submit" className="goout-btn-primary w-full py-3 rounded-xl justify-center">
              Register
            </button>
          </form>
          <p className="mt-6 text-center text-slate-600 text-sm">
            Already have an account? <Link to="/login" className="text-goout-green font-medium hover:underline">Login</Link>
          </p>
        </div>
      </div>
    </div>);

}