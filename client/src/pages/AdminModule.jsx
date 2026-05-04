import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '/api').trim() || '/api';
const ADMIN_TOKEN_KEY = 'goout_admin_token';

function formatDate(value) {
  if (!value) return 'n/a';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return 'n/a';
  }
}

function shortId(value) {
  const raw = String(value || '');
  return raw ? raw.slice(-6) : 'n/a';
}

function adminHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-3xl border border-white/70 bg-white p-4 shadow-sm shadow-slate-200">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{value ?? 0}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function EmptyState({ label }) {
  return <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{label}</p>;
}

export default function AdminModule() {
  const [token, setToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const [email, setEmail] = useState('ruthertom123@gmail.com');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [groups, setGroups] = useState([]);
  const [offers, setOffers] = useState([]);
  const [safetyLogs, setSafetyLogs] = useState([]);
  const [messages, setMessages] = useState([]);

  const isLoggedIn = Boolean(token);
  const stats = dashboard?.stats || {};

  const request = useCallback(async (method, path, data = null) => {
    const config = { method, url: `${API_BASE}${path}`, headers: adminHeaders(token) };
    if (data != null) config.data = data;
    try {
      const response = await axios(config);
      return response.data;
    } catch (err) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setToken('');
      }
      throw err;
    }
  }, [token]);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [dash, userRows, businessRows, groupRows, offerRows, safetyRows, messageRows] = await Promise.all([
        request('GET', '/admin/dashboard'),
        request('GET', '/admin/users'),
        request('GET', '/admin/businesses'),
        request('GET', '/admin/groups'),
        request('GET', '/admin/offers'),
        request('GET', '/admin/safety'),
        request('GET', '/admin/messages')
      ]);
      setDashboard(dash);
      setUsers(userRows.users || []);
      setBusinesses(businessRows.businesses || []);
      setGroups(groupRows.groups || []);
      setOffers(offerRows.offers || []);
      setSafetyLogs(safetyRows.safetyLogs || []);
      setMessages(messageRows.messages || []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Could not load admin data.');
    } finally {
      setLoading(false);
    }
  }, [request, token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const login = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.post(`${API_BASE}/admin/login`, { email, password });
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setToken(data.token);
      setPassword('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Invalid admin credentials.');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken('');
    setDashboard(null);
    setUsers([]);
    setBusinesses([]);
    setGroups([]);
    setOffers([]);
    setSafetyLogs([]);
    setMessages([]);
  };

  const runAction = async (key, action) => {
    setBusyKey(key);
    setError('');
    try {
      await action();
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Admin action failed.');
    } finally {
      setBusyKey('');
    }
  };

  const tabs = useMemo(() => [
    ['overview', 'Overview'],
    ['users', 'Users'],
    ['merchants', 'Merchants'],
    ['groups', 'Groups'],
    ['offers', 'Offers'],
    ['safety', 'Safety'],
    ['messages', 'Messages']
  ], []);

  if (!isLoggedIn) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-4 py-10 text-white">
        <section className="mx-auto flex min-h-[80vh] max-w-md items-center">
          <form onSubmit={login} className="w-full rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl shadow-black/30">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-200">GoOut Admin Module</p>
            <h1 className="mt-3 text-3xl font-black">Admin login</h1>
            <p className="mt-2 text-sm text-slate-300">Only the configured admin account can access this page.</p>
            {error && <p className="mt-4 rounded-2xl border border-red-300/30 bg-red-500/15 px-3 py-2 text-sm text-red-100">{error}</p>}
            <label className="mt-6 block text-sm font-semibold text-slate-200">
              Admin email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/15 bg-white px-4 py-3 text-slate-950 outline-none focus:ring-2 focus:ring-emerald-300"
                autoComplete="username"
              />
            </label>
            <label className="mt-4 block text-sm font-semibold text-slate-200">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/15 bg-white px-4 py-3 text-slate-950 outline-none focus:ring-2 focus:ring-emerald-300"
                autoComplete="current-password"
              />
            </label>
            <button disabled={loading} className="mt-6 w-full rounded-2xl bg-emerald-400 px-4 py-3 font-black text-slate-950 transition hover:bg-emerald-300 disabled:opacity-60">
              {loading ? 'Checking...' : 'Enter admin module'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] bg-slate-950 p-5 text-white shadow-xl shadow-slate-300">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">Admin Module</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">GoOut control center</h1>
              <p className="mt-2 text-sm text-slate-300">Manage users, merchants, Red Pin verification, groups, offers, safety, and recent messages.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={loadAll} disabled={loading} className="rounded-2xl border border-white/15 px-4 py-2 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-60">
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button onClick={logout} className="rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-950 hover:bg-slate-100">
                Logout
              </button>
            </div>
          </div>
        </header>

        {error && <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

        <nav className="mt-5 flex gap-2 overflow-x-auto rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`whitespace-nowrap rounded-2xl px-4 py-2 text-sm font-bold transition ${
                activeTab === id ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === 'overview' && (
          <section className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Users" value={stats.totalUsers} hint={`${stats.explorers || 0} explorers · ${stats.merchants || 0} merchants`} />
              <StatCard label="Businesses" value={stats.totalBusinesses} hint={`${stats.redPinBusinesses || 0} Red Pin · ${stats.pendingBusinesses || 0} pending`} />
              <StatCard label="Groups" value={stats.totalGroups} hint={`${stats.openGroups || 0} open or ongoing`} />
              <StatCard label="Safety SOS" value={stats.sosCount} hint={`${stats.unresolvedSosCount || 0} unresolved`} />
              <StatCard label="Messages" value={stats.totalMessages} hint={`${stats.recentMessages || 0} in last 24h`} />
              <StatCard label="Active Offers" value={stats.activeOffers} hint="Live flash/deal cards" />
              <StatCard label="Visits" value={stats.totalVisits} hint="Logged explorer visits" />
              <StatCard label="Verified Users" value={stats.verifiedUsers} hint={`${stats.activeBuddyUsers || 0} in Buddy Mode`} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Recent users">
                {dashboard?.recentUsers?.length ? dashboard.recentUsers.map((u) => (
                  <Row key={u._id} title={u.name} subtitle={`${u.email} · ${u.role} · ${u.verified ? 'verified' : 'not verified'}`} meta={formatDate(u.createdAt)} />
                )) : <EmptyState label="No recent users." />}
              </Panel>
              <Panel title="Pending merchants">
                {dashboard?.pendingMerchants?.length ? dashboard.pendingMerchants.map((b) => (
                  <Row key={b._id} title={b.mapDisplayName || b.name} subtitle={`${b.category} · owner: ${b.ownerId?.email || 'n/a'}`} meta={`#${shortId(b._id)}`} />
                )) : <EmptyState label="No pending merchant verification." />}
              </Panel>
            </div>
          </section>
        )}

        {activeTab === 'users' && (
          <Panel title="User administration" className="mt-5">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="p-2">User</th><th className="p-2">Role</th><th className="p-2">Verified</th><th className="p-2">Points</th><th className="p-2">Actions</th></tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u._id} className="border-t border-slate-100">
                      <td className="p-2"><b>{u.name}</b><br /><span className="text-xs text-slate-500">{u.email}</span></td>
                      <td className="p-2">{u.role}</td>
                      <td className="p-2">{u.verified ? 'Yes' : 'No'}</td>
                      <td className="p-2">{u.socialPoints || 0} SP · {u.carbonCredits || 0} CC</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <ActionButton busy={busyKey === `uv-${u._id}`} onClick={() => runAction(`uv-${u._id}`, () => request('PATCH', `/admin/users/${u._id}`, { verified: !u.verified }))}>
                            {u.verified ? 'Unverify' : 'Verify'}
                          </ActionButton>
                          <ActionButton busy={busyKey === `ur-${u._id}`} onClick={() => runAction(`ur-${u._id}`, () => request('PATCH', `/admin/users/${u._id}`, { role: u.role === 'merchant' ? 'explorer' : 'merchant' }))}>
                            Make {u.role === 'merchant' ? 'Explorer' : 'Merchant'}
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {activeTab === 'merchants' && (
          <Panel title="Merchant and Red Pin controls" className="mt-5">
            <div className="grid gap-3">
              {businesses.map((b) => {
                const status = b.localVerification?.status || 'none';
                return (
                  <div key={b._id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="font-black text-slate-950">{b.mapDisplayName || b.name}</h3>
                        <p className="text-sm text-slate-600">{b.category} · {b.address || 'No address'} · owner: {b.ownerId?.email || 'n/a'}</p>
                        <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">Status: {status} · Red Pin: {b.localVerification?.redPin ? 'yes' : 'no'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton busy={busyKey === `bv-${b._id}`} onClick={() => runAction(`bv-${b._id}`, () => request('PATCH', `/admin/businesses/${b._id}/verification`, { status: 'verified', redPin: true, notes: 'Approved by admin module.' }))}>Approve Red Pin</ActionButton>
                        <ActionButton busy={busyKey === `bp-${b._id}`} onClick={() => runAction(`bp-${b._id}`, () => request('PATCH', `/admin/businesses/${b._id}/verification`, { status: 'pending', redPin: false, notes: 'Moved to pending by admin.' }))}>Mark Pending</ActionButton>
                        <ActionButton busy={busyKey === `bn-${b._id}`} onClick={() => runAction(`bn-${b._id}`, () => request('PATCH', `/admin/businesses/${b._id}/verification`, { status: 'none', redPin: false, notes: 'Removed verification by admin.' }))}>Remove Pin</ActionButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {activeTab === 'groups' && (
          <Panel title="Buddy groups" className="mt-5">
            <div className="grid gap-3">
              {groups.map((g) => (
                <div key={g._id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="font-black">{g.activity}</h3>
                      <p className="text-sm text-slate-600">Creator: {g.creatorId?.email || 'n/a'} · Members: {g.members?.length || 0}/{g.maxMembers}</p>
                      <p className="text-xs text-slate-500">Scheduled: {formatDate(g.scheduledAt)} · Status: {g.status}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {['open', 'ongoing', 'completed'].map((status) => (
                        <ActionButton key={status} busy={busyKey === `gs-${g._id}-${status}`} onClick={() => runAction(`gs-${g._id}-${status}`, () => request('PATCH', `/admin/groups/${g._id}`, { status }))}>{status}</ActionButton>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {activeTab === 'offers' && (
          <Panel title="Offers and flash deals" className="mt-5">
            <div className="grid gap-3">
              {offers.map((o) => (
                <div key={o._id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="font-black">{o.title}</h3>
                      <p className="text-sm text-slate-600">{o.businessId?.name || 'Merchant'} · ₹{o.offerPrice} · valid until {formatDate(o.validUntil)}</p>
                      <p className="text-xs text-slate-500">Active: {o.isActive ? 'yes' : 'no'} · Flash: {o.isFlash ? 'yes' : 'no'}</p>
                    </div>
                    <ActionButton busy={busyKey === `oa-${o._id}`} onClick={() => runAction(`oa-${o._id}`, () => request('PATCH', `/admin/offers/${o._id}`, { isActive: !o.isActive }))}>
                      {o.isActive ? 'Deactivate' : 'Activate'}
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {activeTab === 'safety' && (
          <Panel title="Safety and SOS logs" className="mt-5">
            <div className="grid gap-3">
              {safetyLogs.map((s) => (
                <div key={s._id} className="rounded-2xl border border-red-100 bg-red-50 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="font-black text-red-950">{String(s.type || '').toUpperCase()}</h3>
                      <p className="text-sm text-red-800">{s.userId?.email || 'Unknown user'} · Group: {s.groupId?.activity || 'n/a'}</p>
                      <p className="text-xs text-red-700">Created: {formatDate(s.createdAt)} · Resolved: {s.resolvedAt ? formatDate(s.resolvedAt) : 'No'}</p>
                    </div>
                    <ActionButton busy={busyKey === `sr-${s._id}`} onClick={() => runAction(`sr-${s._id}`, () => request('PATCH', `/admin/safety/${s._id}`, { resolved: !s.resolvedAt }))}>
                      {s.resolvedAt ? 'Reopen' : 'Mark Resolved'}
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {activeTab === 'messages' && (
          <Panel title="Recent chat messages" className="mt-5">
            <div className="grid gap-3">
              {messages.map((m) => (
                <div key={m._id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{m.groupId?.activity || 'Group'} · {formatDate(m.createdAt)}</p>
                  <p className="mt-1 font-bold text-slate-900">{m.userName || m.userId?.name || 'User'}</p>
                  <p className="mt-1 text-sm text-slate-700">{String(m.message || '').slice(0, 280)}</p>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </section>
    </main>
  );
}

function Panel({ title, children, className = '' }) {
  return (
    <section className={`rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200 ${className}`}>
      <h2 className="mb-3 text-lg font-black text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function Row({ title, subtitle, meta }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-slate-100 py-3 first:border-t-0 first:pt-0">
      <div>
        <p className="font-bold text-slate-900">{title || 'Untitled'}</p>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      <span className="shrink-0 text-xs font-semibold text-slate-400">{meta}</span>
    </div>
  );
}

function ActionButton({ children, busy, onClick }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
    >
      {busy ? 'Working...' : children}
    </button>
  );
}
