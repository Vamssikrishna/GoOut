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
  const [sentRequests, setSentRequests] = useState([]);
  const [suggestedPeers, setSuggestedPeers] = useState([]);
  const [safeVenues, setSafeVenues] = useState({ redPin: [], publicPlazas: [] });
  const [showCreate, setShowCreate] = useState(false);
  const [showPairInvite, setShowPairInvite] = useState(false);
  const [showPairRequestModal, setShowPairRequestModal] = useState(false);
  const [selectedPeerForRequest, setSelectedPeerForRequest] = useState(null);
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [intentModalMode, setIntentModalMode] = useState(''); // 'group' or 'pair'
  const [intentInput, setIntentInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionGroupId, setActionGroupId] = useState('');
  const [error, setError] = useState('');
  const [buddyBusy, setBuddyBusy] = useState(false);
  const [peerIntent, setPeerIntent] = useState('');
  const [peerMaxDistanceKm, setPeerMaxDistanceKm] = useState(8);
  const [matchingPeers, setMatchingPeers] = useState(false);
  const [hasRunPeerMatch, setHasRunPeerMatch] = useState(false);
  const [matchingGroups, setMatchingGroups] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [showPeerSearch, setShowPeerSearch] = useState(false);
  const [pairRequestForm, setPairRequestForm] = useState({
    activity: '',
    scheduledAt: '',
    venueKey: ''
  });
  const [form, setForm] = useState({
    activity: '',
    description: '',
    interests: '',
    meetingPlace: '',
    scheduledAt: '',
    maxMembers: 3,
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

  const openIntentModal = (mode) => {
    // Check if user has profile preferences set
    if (!user?.discoveryPreferences?.prefer || user.discoveryPreferences.prefer.length === 0) {
      setError('Please complete your profile with preferences first. Go to Profile to add your interests and preferences.');
      return;
    }
    setIntentModalMode(mode);
    setIntentInput('');
    setShowIntentModal(true);
  };

  const submitIntent = async () => {
    if (!intentInput.trim()) {
      setError('Please enter your intent for the activity');
      return;
    }

    setError('');
    setShowPeerSearch(true);
    
    if (intentModalMode === 'group') {
      // For group creation, set the activity and show matches
      const intentText = intentInput.trim();
      setForm((f) => ({ ...f, activity: intentText }));
      setShowIntentModal(false);
      setShowCreate(true);
      
      // Auto-generate description on next tick
      setTimeout(async () => {
        setGeneratingDescription(true);
        try {
          const { data } = await api.post('/buddies/generate-description', {
            activity: intentText,
            interests: [],
            meetingPlace: ''
          });
          if (data.description) {
            setForm((f) => ({ ...f, description: data.description }));
          }
        } catch (err) {
          console.error('Auto-generate failed:', err?.response?.data?.error || err.message);
        } finally {
          setGeneratingDescription(false);
        }
      }, 100);
    } else if (intentModalMode === 'pair') {
      // For pair hangout, search for matches and show them
      setPeerIntent(intentInput.trim());
      setShowIntentModal(false);
      
      // Trigger peer matching
      await searchPeersWithIntent(intentInput.trim());
      
      // Then show pair invite form
      setShowPairInvite(true);
    }
  };

  const refreshData = useCallback(async () => {
    const coords = getAnchorCoords();
    setError('');
    try {
      const [groupsRes, invitesRes] = await Promise.all([
        api.get('/buddies/groups'),
        api.get('/buddies/groups/pending-invites')
      ]);
      const allGroups = Array.isArray(groupsRes.data) ? groupsRes.data : [];
      setGroups(allGroups);
      setMatches([]);
      setPendingInvites(Array.isArray(invitesRes.data) ? invitesRes.data : []);
      
      // Sent requests are pair hangouts created by user that target hasn't accepted
      const sent = allGroups.filter(g => 
        String(g.creatorId?._id || g.creatorId) === String(user?.id || user?._id) && 
        g.inviteTargetUserId && 
        !g.members?.some(m => String(m?._id || m) === String(g.inviteTargetUserId))
      );
      setSentRequests(sent);

      if (user?.buddyMode) {
        const venuesRes = await api.get('/buddies/groups/safe-venues', { params: coords });
        setSafeVenues(venuesRes.data || { redPin: [], publicPlazas: [] });
      } else {
        setSuggestedPeers([]);
        setHasRunPeerMatch(false);
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load buddy data right now.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const searchPeersWithIntent = async (customIntent = null) => {
    if (!user?.buddyMode) return;
    const coords = getAnchorCoords();
    setError('');
    setMatchingPeers(true);
    setMatchingGroups(true);
    setHasRunPeerMatch(true);
    try {
      const maxDistanceM = Math.max(1, Number(peerMaxDistanceKm || 8)) * 1000;
      const intentToUse = customIntent || peerIntent;
      const [peersRes, groupsRes] = await Promise.all([
        api.get('/buddies/groups/suggested-peers', {
          params: { ...coords, intent: intentToUse, maxDistance: maxDistanceM }
        }),
        api.get('/buddies/match', {
          params: { ...coords, intent: intentToUse, maxDistance: maxDistanceM }
        })
      ]);
      setSuggestedPeers(Array.isArray(peersRes.data) ? peersRes.data : []);
      setMatches(Array.isArray(groupsRes.data) ? groupsRes.data : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not refresh partner list.');
    } finally {
      setMatchingPeers(false);
      setMatchingGroups(false);
    }
  };

  const sendPairRequest = async () => {
    if (!selectedPeerForRequest || !pairRequestForm.activity.trim() || !pairRequestForm.scheduledAt || !pairRequestForm.venueKey) {
      setError('Please fill in activity, when, and venue.');
      return;
    }
    
    const coords = getAnchorCoords();
    const opts = [
      ...(safeVenues.redPin || []).map((v, i) => ({ ...v, key: `r-${i}` })),
      ...(safeVenues.publicPlazas || []).map((v, i) => ({ ...v, key: `p-${i}` }))
    ];
    const picked = opts.find((v) => v.key === pairRequestForm.venueKey);
    
    if (!picked?.lat || !picked?.lng) {
      setError('Selected venue has no coordinates.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api.post('/buddies/groups', {
        activity: pairRequestForm.activity,
        description: '',
        interests: user?.interests || ['hangout'],
        meetingPlace: picked.name,
        scheduledAt: pairRequestForm.scheduledAt,
        maxMembers: 2,
        lat: coords.lat,
        lng: coords.lng,
        inviteTargetUserId: selectedPeerForRequest.id,
        intentSnippet: peerIntent,
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
      setShowPairRequestModal(false);
      setSelectedPeerForRequest(null);
      setPairRequestForm({ activity: '', scheduledAt: '', venueKey: '' });
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not send pair request.');
    } finally {
      setSubmitting(false);
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
      setShowPeerSearch(false);
      setForm({ activity: '', description: '', interests: '', meetingPlace: '', scheduledAt: '', maxMembers: 3, safeBy: '' });
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
      setShowPeerSearch(false);
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

  const rejectHangout = async (id) => {
    const confirmed = window.confirm('Are you sure you want to remove this hangout invitation?');
    if (!confirmed) return;
    setActionGroupId(id);
    setError('');
    try {
      await api.post(`/buddies/groups/${id}/reject-hangout`);
      await refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not reject hangout.');
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
  const openMatchCount = hasRunPeerMatch ? matches.filter((g) => g?.status === 'open').length : 0;
  const pendingForMe = groups.reduce((sum, g) => sum + (g?.pendingRequests?.length || 0), 0);

  const venueOptions = [
    ...(safeVenues.redPin || []).map((v, i) => ({ ...v, key: `r-${i}` })),
    ...(safeVenues.publicPlazas || []).map((v, i) => ({ ...v, key: `p-${i}` }))
  ];

  return (
    <div className="space-y-8 goout-animate-in">
      <div className="goout-glass-card rounded-2xl p-6 md:p-7 goout-hover-lift border border-white/50">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div>
            <h1 className="font-display font-bold text-2xl md:text-3xl bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
              GoOut Buddies
            </h1>
            <p className="text-sm text-slate-600 mt-2 max-w-xl leading-relaxed">
              AI-assisted interest matching, Red Pin or public meetups only, and Buddy Mode privacy.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={refreshData} className="goout-btn-ghost text-sm py-2 px-3">
              Refresh
            </button>
            <button
              type="button"
              onClick={() => openIntentModal('group')}
              className="goout-btn-primary text-sm py-2 px-4">
              Create group
            </button>
            <button
              type="button"
              onClick={() => openIntentModal('pair')}
              className="goout-btn-ghost text-sm py-2 px-3 border-emerald-200/80 text-emerald-800 hover:bg-emerald-50/80">
              Pair hangout invite
            </button>
          </div>
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
                <div className="self-center flex gap-2">
                  <button
                    type="button"
                    disabled={actionGroupId === g._id}
                    onClick={() => acceptHangout(g._id)}
                    className="px-4 py-2 bg-goout-green text-white rounded-lg text-sm font-medium disabled:opacity-60">
                    {actionGroupId === g._id ? '…' : 'Accept hangout'}
                  </button>
                  <button
                    type="button"
                    disabled={actionGroupId === g._id}
                    onClick={() => rejectHangout(g._id)}
                    className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium disabled:opacity-60">
                    {actionGroupId === g._id ? '…' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sentRequests.length > 0 && (
        <div className="goout-surface rounded-2xl p-5 border border-blue-200 bg-blue-50/40">
          <h2 className="font-display font-semibold text-lg mb-2">Hangout requests sent</h2>
          <p className="text-xs text-slate-600 mb-4">
            Waiting for {sentRequests.length === 1 ? 'them' : 'them'} to accept your hangout request.
          </p>
          <div className="space-y-3">
            {sentRequests.map((g) => (
              <div key={g._id} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{g.activity}</p>
                  <p className="text-sm text-slate-600">{g.description}</p>
                  <p className="text-xs text-slate-500 mt-2">{formatDateTime(g.scheduledAt)}</p>
                  {g.inviteTargetUserId && (
                    <p className="text-xs text-slate-600 mt-2">
                      To <span className="font-semibold">{g.inviteTargetUserId.displayName || 'Explorer'}</span>
                    </p>
                  )}
                  {g.safeVenue?.name && (
                    <p className="text-xs text-blue-800 mt-1">
                      Meetup: {g.safeVenue.name} ({g.safeVenue.kind === 'red_pin' ? 'Red Pin' : 'Public'})
                    </p>
                  )}
                </div>
                <div className="self-center">
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium">
                    Pending
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {user?.buddyMode && showPeerSearch && (
        <div className="goout-surface rounded-2xl p-5 border border-slate-200">
          <h2 className="font-display font-semibold text-lg mb-2">Suggested partners (intent + proximity)</h2>
          <p className="text-xs text-slate-600 mb-3">
            Enter intent first, then search. AI matching will show both buddy users and matching groups.
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
              {matchingPeers ? 'Matching…' : 'Match users'}
            </button>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-slate-500 mb-1">Proximity (km)</label>
            <input
              type="number"
              min={1}
              max={30}
              value={peerMaxDistanceKm}
              onChange={(e) => setPeerMaxDistanceKm(Math.max(1, Math.min(30, Number(e.target.value) || 8)))}
              className="w-32 px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Loading suggestions…</p>
          ) : !hasRunPeerMatch ? (
            <p className="text-sm text-slate-500">Run matching to see users.</p>
          ) : suggestedPeers.length === 0 ? (
            <p className="text-sm text-slate-500">No one is there to meet right now.</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {suggestedPeers.map((p) => (
                <li key={p.id} className="px-3 py-2 flex flex-wrap justify-between gap-2 text-sm bg-white">
                  <span>
                    <span className="font-medium text-slate-900">{p.displayName}</span>
                    <span className="text-slate-500"> · Green {p.greenScore}</span>
                    {p.interests?.length ? <span className="text-slate-600"> · {p.interests.join(', ')}</span> : null}
                  </span>
                  <span className="text-xs text-slate-400">
                    match {Number(p.matchPercent || 0)}% · intent {Number(p.intentPercent || 0)}% · proximity {Number(p.proximityPercent || 0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showCreate && !showPairInvite &&
      <div className="goout-surface rounded-2xl p-6">
          <h2 className="font-display font-semibold text-lg mb-4">Create Buddy Group</h2>
          <form onSubmit={createGroup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Activity</label>
              <input
                type="text"
                value={form.activity}
                onChange={(e) => setForm((f) => ({ ...f, activity: e.target.value }))}
                onBlur={() => {
                  if (form.activity.trim() && !form.description) {
                    autoGenerateDescription();
                  }
                }}
                placeholder="e.g. Coffee, Park walk, Hiking"
                required
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description {generatingDescription && <span className="text-xs text-blue-500">✨ Generating...</span>}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="AI will auto-generate based on activity, or write your own"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                rows="3"
              />
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
              onChange={(e) => setForm((f) => ({ ...f, maxMembers: Number(e.target.value) || 3 }))}
              min={3}
              max={20}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
              <p className="text-xs text-slate-500 mt-1">Group size must be more than 2 (3 to 20).</p>
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
              <button type="button" disabled={submitting} onClick={() => {
                setShowCreate(false);
                setShowPeerSearch(false);
              }} className="px-4 py-2 border border-slate-200 rounded-lg disabled:opacity-60">
                Cancel
              </button>
            </div>
          </form>
        </div>
      }

      {showPairInvite && !showCreate && (
        <div className="goout-surface rounded-2xl p-6 border border-goout-green/30">
          <h2 className="font-display font-semibold text-lg mb-2">Find hangout partners</h2>
          <p className="text-sm text-slate-600 mb-4">
            Browse other explorers looking for the same activity. Send requests to connect with them.
          </p>
          
          {matchingPeers || loading ? (
            <div className="text-center py-8">
              <div className="inline-block h-8 w-8 rounded-full border-2 border-goout-green/30 border-t-goout-green animate-spin" />
              <p className="text-sm text-slate-600 mt-2">Finding partners…</p>
            </div>
          ) : !hasRunPeerMatch ? (
            <p className="text-slate-600 text-sm text-center py-8">Run matching above to see available partners.</p>
          ) : suggestedPeers.length === 0 ? (
            <p className="text-slate-600 text-sm text-center py-8">No one is looking for this activity right now.</p>
          ) : (
            <div className="space-y-3">
              {suggestedPeers
                .filter(p => String(p.id) !== String(user?.id || user?._id))
                .map((p) => (
                  <div key={p.id} className="border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{p.displayName}</p>
                      <p className="text-sm text-slate-600">
                        Green score: <span className="font-semibold text-goout-green">{p.greenScore}</span>
                        {p.interests?.length ? ` · ${p.interests.join(', ')}` : ''}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Intent match: {Number(p.intentPercent || p.matchPercent || 0)}% · Distance: {Number(p.proximityPercent || 0)}%
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPeerForRequest(p);
                        setShowPairRequestModal(true);
                      }}
                      className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium text-sm whitespace-nowrap hover:bg-goout-green/90 disabled:opacity-60"
                    >
                      Send Request
                    </button>
                  </div>
                ))}
            </div>
          )}
          
          <div className="mt-6 flex gap-2">
            <button 
              type="button" 
              onClick={() => {
                setShowPairInvite(false);
                setShowPeerSearch(false);
              }}
              className="px-4 py-2 border border-slate-200 rounded-lg font-medium"
            >
              Done
            </button>
          </div>
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
          <h2 className="font-display font-semibold text-lg mb-4">Discover Groups (intent match)</h2>
          <div className="space-y-3">
            {matchingGroups ?
            <div className="goout-soft-card rounded-xl p-4 text-sm text-slate-500">Matching groups...</div> :
            loading ?
            <div className="goout-soft-card rounded-xl p-4 text-sm text-slate-500">Finding nearby groups...</div> :
            !hasRunPeerMatch ?
            <p className="text-slate-500 text-sm">Enter intent and click Match users to see matching groups.</p> :
            matches.length === 0 ?
            <p className="text-slate-500 text-sm">No one is there to meet right now.</p> :

            matches.map((g) =>
            <div key={g._id} className="goout-soft-card rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{g.activity}</p>
                    {g.creatorId?.verified && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">Verified host</span>}
                  </div>
                  <p className="text-sm text-slate-600">{g.description}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {formatDateTime(g.scheduledAt)} · {g.members?.length || 0}/{g.maxMembers} members · match {Number(g.matchPercent || Math.round((g.similarity || 0) * 100))}%
                  </p>
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

      {/* Pair Request Modal */}
      {showPairRequestModal && selectedPeerForRequest && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 goout-animate-in">
            <h2 className="text-xl font-bold text-slate-900 mb-2">Send hangout request to {selectedPeerForRequest.displayName}?</h2>
            <p className="text-sm text-slate-600 mb-4">
              Choose where to meet and when. They'll see your profile basics (name, interests, Green score).
            </p>
            {error && <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Activity</label>
                <input
                  type="text"
                  value={pairRequestForm.activity}
                  onChange={(e) => setPairRequestForm((f) => ({ ...f, activity: e.target.value }))}
                  placeholder="e.g. Coffee, gallery walk"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Safe venue</label>
                <select
                  required
                  value={pairRequestForm.venueKey}
                  onChange={(e) => setPairRequestForm((f) => ({ ...f, venueKey: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm">
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
                <label className="block text-sm font-medium mb-1">When</label>
                <input
                  type="datetime-local"
                  required
                  value={pairRequestForm.scheduledAt}
                  onChange={(e) => setPairRequestForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
            </div>
            
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => {
                  setShowPairRequestModal(false);
                  setSelectedPeerForRequest(null);
                  setPairRequestForm({ activity: '', scheduledAt: '', venueKey: '' });
                }}
                disabled={submitting}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={sendPairRequest}
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-goout-green text-white rounded-lg font-medium hover:bg-goout-green/90 disabled:opacity-60"
              >
                {submitting ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Intent Input Modal */}
      {showIntentModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 goout-animate-in">
            <h2 className="text-xl font-bold text-slate-900 mb-2">
              {intentModalMode === 'group' ? 'What activity do you want to do?' : 'What are you looking for?'}
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              {intentModalMode === 'group' 
                ? 'Tell us the activity and we\'ll auto-generate a description. AI will match with other explorers based on your profile.' 
                : 'Describe what you\'re looking for. We\'ll find matching partners based on preferences.'}
            </p>
            {error && <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
            <input
              type="text"
              value={intentInput}
              onChange={(e) => setIntentInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && submitIntent()}
              placeholder={intentModalMode === 'group' ? 'e.g., Coffee, hiking, reading club' : 'e.g., Casual meetup, outdoor activity, food adventure'}
              autoFocus
              className="w-full px-4 py-3 border border-slate-200 rounded-lg mb-4 focus:ring-2 focus:ring-goout-green focus:border-transparent"
              maxLength="150"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowIntentModal(false);
                  setShowPeerSearch(false);
                }}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitIntent}
                disabled={!intentInput.trim()}
                className="flex-1 px-4 py-2 bg-goout-green text-white rounded-lg font-medium disabled:opacity-60 hover:bg-green-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>);

}
