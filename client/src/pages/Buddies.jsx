import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const FALLBACK_COORDS = { lng: 77.209, lat: 28.6139 };

function formatDateTime(value) {
  if (!value) return 'Schedule not set';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'Schedule not set';
  return dt.toLocaleString();
}

export default function Buddies() {
  const { user, updateUser } = useAuth();
  const [groups, setGroups] = useState([]);
  const [matches, setMatches] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [suggestedPeers, setSuggestedPeers] = useState([]);
  const [safeVenues, setSafeVenues] = useState({ redPin: [], publicPlazas: [] });
  const [showCreate, setShowCreate] = useState(false);
  const [showPairInvite, setShowPairInvite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionGroupId, setActionGroupId] = useState('');
  const [error, setError] = useState('');
  const [buddyBusy, setBuddyBusy] = useState(false);
  const [peerIntent, setPeerIntent] = useState('');
  const [form, setForm] = useState({
    activity: '',
    description: '',
    interests: '',
    meetingPlace: '',
    scheduledAt: '',
    maxMembers: 6,
    safeBy: ''
  });
  const [pairForm, setPairForm] = useState({
    inviteUserId: '',
    activity: '',
    description: '',
    scheduledAt: '',
    intentSnippet: '',
    venueKey: ''
  });

  const getAnchorCoords = () => {
    if (user?.location?.coordinates?.length === 2) {
      return { lng: user.location.coordinates[0], lat: user.location.coordinates[1] };
    }
    return FALLBACK_COORDS;
  };

  const refreshData = useCallback(async () => {
    const coords = getAnchorCoords();
    setError('');
    try {
      const interestParam = (user?.interests || []).join(',');
      const [groupsRes, matchesRes, invitesRes] = await Promise.all([
        api.get('/buddies/groups'),
        api.get('/buddies/match', { params: { ...coords, interests: interestParam } }),
        api.get('/buddies/groups/pending-invites')
      ]);
      setGroups(Array.isArray(groupsRes.data) ? groupsRes.data : []);
      setMatches(Array.isArray(matchesRes.data) ? matchesRes.data : []);
      setPendingInvites(Array.isArray(invitesRes.data) ? invitesRes.data : []);

      if (user?.buddyMode) {
        const peersRes = await api.get('/buddies/groups/suggested-peers', { params: { ...coords } });
        setSuggestedPeers(Array.isArray(peersRes.data) ? peersRes.data : []);
        const venuesRes = await api.get('/buddies/groups/safe-venues', { params: coords });
        setSafeVenues(venuesRes.data || { redPin: [], publicPlazas: [] });
      } else {
        setSuggestedPeers([]);
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load buddy data right now.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const searchPeersWithIntent = async () => {
    if (!user?.buddyMode) return;
    const coords = getAnchorCoords();
    setError('');
    try {
      const peersRes = await api.get('/buddies/groups/suggested-peers', {
        params: { ...coords, intent: peerIntent }
      });
      setSuggestedPeers(Array.isArray(peersRes.data) ? peersRes.data : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not refresh partner list.');
    }
  };

  useEffect(() => {
    setLoading(true);
    refreshData();
  }, [refreshData]);

  const toggleBuddyMode = async () => {
    setBuddyBusy(true);
    setError('');
    try {
      const { data } = await api.put('/users/profile', { buddyMode: !user?.buddyMode });
      updateUser({ buddyMode: data.buddyMode, interests: data.interests, name: data.name });
      await refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not update Buddy Mode.');
    } finally {
      setBuddyBusy(false);
    }
  };

  const createGroup = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const coords = getAnchorCoords();
      await api.post('/buddies/groups', {
        ...form,
        interests: form.interests.split(',').map((s) => s.trim()).filter(Boolean),
        lat: coords.lat,
        lng: coords.lng,
        safeBy: form.safeBy ? new Date(form.safeBy).toISOString() : undefined
      });
      await refreshData();
      setShowCreate(false);
      setForm({ activity: '', description: '', interests: '', meetingPlace: '', scheduledAt: '', maxMembers: 6, safeBy: '' });
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create the group. Check fields and retry.');
    } finally {
      setSubmitting(false);
    }
  };

  const createPairInvite = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const coords = getAnchorCoords();
      const opts = [
        ...(safeVenues.redPin || []).map((v, i) => ({ ...v, key: `r-${i}` })),
        ...(safeVenues.publicPlazas || []).map((v, i) => ({ ...v, key: `p-${i}` }))
      ];
      const picked = opts.find((v) => v.key === pairForm.venueKey);
      if (!pairForm.inviteUserId || !picked?.lat || !picked?.lng) {
        setError('Choose a guest and a safe venue from the list.');
        setSubmitting(false);
        return;
      }
      await api.post('/buddies/groups', {
        activity: pairForm.activity,
        description: pairForm.description,
        interests: (user?.interests || []).length ? user.interests : ['hangout'],
        meetingPlace: picked.name,
        scheduledAt: pairForm.scheduledAt,
        maxMembers: 2,
        lat: coords.lat,
        lng: coords.lng,
        inviteTargetUserId: pairForm.inviteUserId,
        intentSnippet: pairForm.intentSnippet,
        safeVenue: {
          kind: picked.kind,
          name: picked.name,
          lat: picked.lat,
          lng: picked.lng,
          businessId: picked.businessId,
          placeId: picked.placeId || '',
          safetyNote: picked.safetyNote || ''
        }
      });
      await refreshData();
      setShowPairInvite(false);
      setPairForm({
        inviteUserId: '',
        activity: '',
        description: '',
        scheduledAt: '',
        intentSnippet: '',
        venueKey: ''
      });
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not send hangout invite.');
    } finally {
      setSubmitting(false);
    }
  };

  const joinGroup = async (id) => {
    setActionGroupId(id);
    setError('');
    try {
      await api.post(`/buddies/groups/${id}/join`);
      await refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to send join request.');
    } finally {
      setActionGroupId('');
    }
  };

  const acceptHangout = async (id) => {
    setActionGroupId(id);
    setError('');
    try {
      await api.post(`/buddies/groups/${id}/accept-hangout`);
      await refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not accept hangout.');
    } finally {
      setActionGroupId('');
    }
  };

  const acceptRequest = async (groupId, userId) => {
    setActionGroupId(groupId);
    setError('');
    try {
      await api.post(`/buddies/groups/${groupId}/accept/${userId}`);
      await refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to accept request right now.');
    } finally {
      setActionGroupId('');
    }
  };

  const rejectRequest = async (groupId, userId) => {
    setActionGroupId(groupId);
    setError('');
    try {
      await api.post(`/buddies/groups/${groupId}/reject/${userId}`);
      await refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to reject request right now.');
    } finally {
      setActionGroupId('');
    }
  };

  const leaveGroup = async (groupId) => {
    setActionGroupId(groupId);
    setError('');
    try {
      await api.post(`/buddies/groups/${groupId}/leave`);
      await refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to leave group right now.');
    } finally {
      setActionGroupId('');
    }
  };

  const myId = String(user?.id || user?._id || '');
  const openMatchCount = matches.filter((g) => g?.status === 'open').length;
  const pendingForMe = groups.reduce((sum, g) => sum + (g?.pendingRequests?.length || 0), 0);

  const venueOptions = [
    ...(safeVenues.redPin || []).map((v, i) => ({ ...v, key: `r-${i}` })),
    ...(safeVenues.publicPlazas || []).map((v, i) => ({ ...v, key: `p-${i}` }))
  ];

  return (
    <div className="space-y-6 goout-animate-in">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl text-goout-dark">GoOut Buddies</h1>
          <p className="text-sm text-slate-600 mt-1">
            AI-assisted interest matching, Red Pin or public meetups only, and Buddy Mode privacy.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refreshData}
            className="px-4 py-2 border border-slate-200 bg-white rounded-lg font-medium hover:bg-slate-50 transition">
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium hover:bg-goout-accent transition">
            Create Group
          </button>
          <button
            type="button"
            onClick={() => {
              setShowPairInvite(true);
              const c = getAnchorCoords();
              api.get('/buddies/groups/safe-venues', { params: c }).then(({ data }) => setSafeVenues(data || { redPin: [], publicPlazas: [] })).catch(() => {});
            }}
            className="px-4 py-2 border border-goout-green text-goout-green rounded-lg font-medium hover:bg-goout-mint transition">
            Pair hangout invite
          </button>
        </div>
      </div>

      <div className="goout-surface rounded-2xl p-5 border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-semibold text-slate-900">Buddy Mode</h2>
            <p className="text-sm text-slate-600 mt-1 max-w-xl">
              When off, you are hidden from suggested partner lists and open group discovery hosts. Turn on when you want to explore with someone.
            </p>
          </div>
          <button
            type="button"
            disabled={buddyBusy}
            onClick={toggleBuddyMode}
            className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition disabled:opacity-60 ${
              user?.buddyMode ? 'bg-goout-green text-white' : 'bg-slate-200 text-slate-800'
            }`}>
            {buddyBusy ? 'Saving…' : user?.buddyMode ? 'Buddy Mode: On' : 'Buddy Mode: Off'}
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="goout-soft-card rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Your Groups</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{groups.length}</p>
        </div>
        <div className="goout-soft-card rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Open Nearby</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{openMatchCount}</p>
        </div>
        <div className="goout-soft-card rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Pending</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{pendingForMe + pendingInvites.length}</p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {pendingInvites.length > 0 && (
        <div className="goout-surface rounded-2xl p-5 border border-emerald-200 bg-emerald-50/40">
          <h2 className="font-display font-semibold text-lg mb-2">Hangout invites for you</h2>
          <p className="text-xs text-slate-600 mb-4">
            You see first name, interests, and Green Score until you accept. Meet only at the pinned safe venue.
          </p>
          <div className="space-y-3">
            {pendingInvites.map((g) => (
              <div key={g._id} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{g.activity}</p>
                  <p className="text-sm text-slate-600">{g.description}</p>
                  <p className="text-xs text-slate-500 mt-2">{formatDateTime(g.scheduledAt)}</p>
                  {g.creatorBuddyPreview && (
                    <p className="text-xs text-slate-600 mt-2">
                      From <span className="font-semibold">{g.creatorBuddyPreview.displayName}</span>
                      {' · '}
                      Green score <span className="font-semibold text-goout-green">{g.creatorBuddyPreview.greenScore}</span>
                      {g.creatorBuddyPreview.interests?.length ? (
                        <>
                          {' · '}
                          Interests: {g.creatorBuddyPreview.interests.join(', ')}
                        </>
                      ) : null}
                    </p>
                  )}
                  {g.safeVenue?.name && (
                    <p className="text-xs text-emerald-800 mt-1">
                      Safe meetup: {g.safeVenue.name} ({g.safeVenue.kind === 'red_pin' ? 'Red Pin' : 'Public'})
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={actionGroupId === g._id}
                  onClick={() => acceptHangout(g._id)}
                  className="self-center px-4 py-2 bg-goout-green text-white rounded-lg text-sm font-medium disabled:opacity-60">
                  {actionGroupId === g._id ? '…' : 'Accept hangout'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {user?.buddyMode && (
        <div className="goout-surface rounded-2xl p-5 border border-slate-200">
          <h2 className="font-display font-semibold text-lg mb-2">Suggested partners (intent + proximity)</h2>
          <p className="text-xs text-slate-600 mb-3">
            Tell City Concierge what you want (e.g. pottery shops), then tune matches here. Same interests and nearby explorers with Buddy Mode on rise to the top.
          </p>
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <input
              type="text"
              value={peerIntent}
              onChange={(e) => setPeerIntent(e.target.value)}
              placeholder="e.g. pottery sustainability art walk"
              className="flex-1 min-w-[200px] max-w-lg px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={searchPeersWithIntent}
              className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium">
              Search with intent
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Loading suggestions…</p>
          ) : suggestedPeers.length === 0 ? (
            <p className="text-sm text-slate-500">No explorers in range right now. Try again after more people enable Buddy Mode.</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {suggestedPeers.map((p) => (
                <li key={p.id} className="px-3 py-2 flex flex-wrap justify-between gap-2 text-sm bg-white">
                  <span>
                    <span className="font-medium text-slate-900">{p.displayName}</span>
                    <span className="text-slate-500"> · Green {p.greenScore}</span>
                    {p.interests?.length ? <span className="text-slate-600"> · {p.interests.join(', ')}</span> : null}
                  </span>
                  <span className="text-xs text-slate-400">match {Math.round((p.similarity || 0) * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showCreate &&
      <div className="goout-surface rounded-2xl p-6">
          <h2 className="font-display font-semibold text-lg mb-4">Create Buddy Group</h2>
          <form onSubmit={createGroup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Activity</label>
              <input
              type="text"
              value={form.activity}
              onChange={(e) => setForm((f) => ({ ...f, activity: e.target.value }))}
              placeholder="e.g. Coffee, Park walk"
              required
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
            
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
            
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Interests (comma-separated)</label>
              <input
              type="text"
              value={form.interests}
              onChange={(e) => setForm((f) => ({ ...f, interests: e.target.value }))}
              placeholder="cafe, reading, walking"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
            
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Meeting place (optional label)</label>
              <input
              type="text"
              value={form.meetingPlace}
              onChange={(e) => setForm((f) => ({ ...f, meetingPlace: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
              <p className="text-xs text-slate-500 mt-1">Do not use home addresses. For private pair hangs, use Pair hangout invite with a safe venue.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">When</label>
              <input
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              required
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
            
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max members</label>
              <input
              type="number"
              value={form.maxMembers}
              onChange={(e) => setForm((f) => ({ ...f, maxMembers: Number(e.target.value) || 6 }))}
              min={2}
              max={12}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
            
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Safety check deadline</label>
              <input
              type="datetime-local"
              value={form.safeBy}
              onChange={(e) => setForm((f) => ({ ...f, safeBy: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
            
              <p className="text-xs text-slate-500 mt-1">If you do not confirm safety by this time, the emergency contact is notified.</p>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={submitting} className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium disabled:opacity-60">
                {submitting ? 'Creating...' : 'Create'}
              </button>
              <button type="button" disabled={submitting} onClick={() => setShowCreate(false)} className="px-4 py-2 border border-slate-200 rounded-lg disabled:opacity-60">
                Cancel
              </button>
            </div>
          </form>
        </div>
      }

      {showPairInvite && (
        <div className="goout-surface rounded-2xl p-6 border border-goout-green/30">
          <h2 className="font-display font-semibold text-lg mb-2">Pair hangout invite</h2>
          <p className="text-sm text-slate-600 mb-4">
            Pick someone from suggestions (they need Buddy Mode on), then a Red Pin or public plaza. We never use private addresses.
          </p>
          <form onSubmit={createPairInvite} className="space-y-4 max-w-xl">
            <div>
              <label className="block text-sm font-medium mb-1">Guest</label>
              <select
                required
                value={pairForm.inviteUserId}
                onChange={(e) => setPairForm((f) => ({ ...f, inviteUserId: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg">
                <option value="">Select explorer</option>
                {suggestedPeers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} · Green {p.greenScore}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Safe venue</label>
              <select
                required
                value={pairForm.venueKey}
                onChange={(e) => setPairForm((f) => ({ ...f, venueKey: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg">
                <option value="">Choose venue</option>
                {venueOptions.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.kind === 'red_pin' ? 'Red Pin: ' : 'Public: '}
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Activity</label>
              <input
                required
                value={pairForm.activity}
                onChange={(e) => setPairForm((f) => ({ ...f, activity: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                placeholder="e.g. Pottery gallery crawl"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={pairForm.description}
                onChange={(e) => setPairForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Intent (for AI / history)</label>
              <input
                value={pairForm.intentSnippet}
                onChange={(e) => setPairForm((f) => ({ ...f, intentSnippet: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                placeholder="Short line, e.g. explore local pottery together"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">When</label>
              <input
                type="datetime-local"
                required
                value={pairForm.scheduledAt}
                onChange={(e) => setPairForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={submitting} className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium disabled:opacity-60">
                {submitting ? 'Sending…' : 'Send invite'}
              </button>
              <button type="button" disabled={submitting} onClick={() => setShowPairInvite(false)} className="px-4 py-2 border border-slate-200 rounded-lg">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="font-display font-semibold text-lg mb-4">Your Groups</h2>
          <div className="space-y-3">
            {loading ?
            <div className="goout-soft-card rounded-xl p-4 text-sm text-slate-500">Loading your groups...</div> :
            groups.length === 0 ?
            <p className="text-slate-500 text-sm">You haven't joined any groups yet.</p> :

            groups.map((g) =>
            <div key={g._id} className="goout-soft-card rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{g.activity}</p>
                      <p className="text-sm text-slate-600 mt-1">{g.description || 'No description provided.'}</p>
                      <p className="text-xs text-slate-500 mt-2">{formatDateTime(g.scheduledAt)} · {g.members?.length || 0}/{g.maxMembers} members</p>
                      {g.safeVenue?.name && (
                        <p className="text-xs text-emerald-800 mt-1">Meet: {g.safeVenue.name}</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${g.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                      {g.status || 'open'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={`/app/group/${g._id}`} className="px-3 py-1.5 text-sm rounded-lg bg-goout-green text-white font-medium hover:bg-goout-accent">
                      Open Chat
                    </Link>
                    <button
                  disabled={actionGroupId === g._id}
                  onClick={() => leaveGroup(g._id)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-60">
                      {actionGroupId === g._id ? 'Please wait...' : 'Leave'}
                    </button>
                  </div>
                  {String(g.creatorId?._id) === String(user?.id || user?._id) && (g.pendingRequests?.length || 0) > 0 &&
              <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-slate-700">Pending requests</p>
                      {g.pendingRequests.map((p) =>
                <div key={p._id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                          <span className="text-sm text-slate-700">{p.name || 'User'}</span>
                          <div className="flex gap-1.5">
                            <button disabled={actionGroupId === g._id} onClick={() => acceptRequest(g._id, p._id)} className="px-2 py-1 text-xs rounded bg-goout-green text-white disabled:opacity-60">
                              Accept
                            </button>
                            <button disabled={actionGroupId === g._id} onClick={() => rejectRequest(g._id, p._id)} className="px-2 py-1 text-xs rounded bg-red-100 text-red-700 disabled:opacity-60">
                              Reject
                            </button>
                          </div>
                        </div>
                )}
                    </div>
              }
                </div>
            )
            }
          </div>
        </div>
        <div>
          <h2 className="font-display font-semibold text-lg mb-4">Discover Groups</h2>
          <div className="space-y-3">
            {loading ?
            <div className="goout-soft-card rounded-xl p-4 text-sm text-slate-500">Finding nearby groups...</div> :
            matches.length === 0 ?
            <p className="text-slate-500 text-sm">No open groups nearby. Create one!</p> :

            matches.map((g) =>
            <div key={g._id} className="goout-soft-card rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{g.activity}</p>
                    {g.creatorId?.verified && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">Verified host</span>}
                  </div>
                  <p className="text-sm text-slate-600">{g.description}</p>
                  <p className="text-xs text-slate-500 mt-1">{formatDateTime(g.scheduledAt)} · {g.members?.length || 0}/{g.maxMembers} members</p>
                  {!g.members?.some((m) => String(m?._id) === myId) && g.status === 'open' &&
              <button
                disabled={actionGroupId === g._id}
                onClick={() => joinGroup(g._id)}
                className="mt-2 px-3 py-1.5 bg-goout-green text-white text-sm rounded-lg disabled:opacity-60">
                      {actionGroupId === g._id ? 'Sending...' : 'Request to Join'}
                    </button>
              }
                  {g.members?.some((m) => String(m?._id) === myId) &&
                  <p className="mt-2 text-xs text-green-700 bg-green-50 border border-green-100 rounded px-2 py-1 inline-block">You are already in this group</p>
                  }
                </div>
            )
            }
          </div>
        </div>
      </div>
    </div>);

}
