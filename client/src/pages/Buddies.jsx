import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import ExplorerCalendar from '../components/explorer/ExplorerCalendar';

const FALLBACK_COORDS = { lng: 77.209, lat: 28.6139 };

function formatDateTime(value) {
  if (!value) return 'Schedule not set';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'Schedule not set';
  return dt.toLocaleString();
}

function planDateMs(value) {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function normalizeBuddyPlans(groups, myId) {
  const me = String(myId || '');
  return (Array.isArray(groups) ? groups : [])
    .map((g) => {
      const id = String(g?._id || '');
      if (!id) return null;
      const scheduledTs = planDateMs(g?.scheduledAt);
      if (scheduledTs == null) return null;
      const creatorId = String(g?.creatorId?._id || g?.creatorId || '');
      const memberIds = Array.isArray(g?.members) ? g.members.map((m) => String(m?._id || m || '')) : [];
      const pendingIds = Array.isArray(g?.pendingRequests) ? g.pendingRequests.map((m) => String(m?._id || m || '')) : [];
      const roleLabel =
        creatorId === me ? 'Host' :
          memberIds.includes(me) ? 'Member' :
            pendingIds.includes(me) ? 'Pending approval' :
              'Invite';
      const venueName = String(g?.safeVenue?.name || g?.meetingPlace || '').trim() || 'Venue TBD';
      const lat = Number(g?.safeVenue?.lat);
      const lng = Number(g?.safeVenue?.lng);
      return {
        id,
        title: String(g?.activity || 'Buddy meetup'),
        scheduledAt: g?.scheduledAt,
        scheduledTs,
        status: String(g?.status || 'open'),
        venueName,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        roleLabel
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.scheduledTs - b.scheduledTs);
}

function mergeUniqueGroups(primary, secondary) {
  const byId = new Map();
  [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])].forEach((g) => {
    const id = String(g?._id || '');
    if (!id) return;
    if (!byId.has(id)) byId.set(id, g);
  });
  return [...byId.values()];
}

export default function Buddies() {
  const { user, updateUser } = useAuth();
  const userId = String(user?.id || user?._id || '');
  const buddyModeEnabled = Boolean(user?.buddyMode);
  const [groups, setGroups] = useState([]);
  const [matches, setMatches] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [suggestedPeers, setSuggestedPeers] = useState([]);
  const [safeVenues, setSafeVenues] = useState({ redPin: [], publicPlazas: [] });
  const [showCreate, setShowCreate] = useState(false);
  const [showPairInvite, setShowPairInvite] = useState(false);
  const [showAllPairMatches, setShowAllPairMatches] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [intentModalMode, setIntentModalMode] = useState(''); // 'group' or 'pair'
  const [intentInput, setIntentInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionGroupId, setActionGroupId] = useState('');
  const [error, setError] = useState('');
  const [buddyBusy, setBuddyBusy] = useState(false);
  const [sendingPairRequestId, setSendingPairRequestId] = useState('');
  const [sentPairRequestIds, setSentPairRequestIds] = useState(new Set());
  const [peerIntent, setPeerIntent] = useState('');
  const [matchingPeers, setMatchingPeers] = useState(false);
  const [hasRunPeerMatch, setHasRunPeerMatch] = useState(false);
  const [matchingGroups, setMatchingGroups] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [showPeerSearch, setShowPeerSearch] = useState(false);
  const [meetingPlaceDraft, setMeetingPlaceDraft] = useState('');
  const loadedUserIdRef = useRef('');
  const [form, setForm] = useState({
    activity: '',
    description: '',
    meetingPlace: '',
    scheduledAt: '',
    maxMembers: '',
    safeBy: ''
  });

  const getAnchorCoords = useCallback(() => {
    if (user?.location?.coordinates?.length === 2) {
      const lng = Number(user.location.coordinates[0]);
      const lat = Number(user.location.coordinates[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
    }
    return FALLBACK_COORDS;
  }, [user?.location?.coordinates]);

  const openIntentModal = (mode) => {
    if (!buddyModeEnabled) {
      setError('Turn on Buddy Mode first to create groups or pair hangouts.');
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
      const intentText = intentInput.trim();
      setForm((f) => ({ ...f, activity: intentText, description: '' }));
      setMeetingPlaceDraft('');
      setShowIntentModal(false);
      setShowCreate(true);
    } else if (intentModalMode === 'pair') {
      setPeerIntent(intentInput.trim());
      setShowIntentModal(false);
      setShowAllPairMatches(false);
      await searchPeersWithIntent(intentInput.trim());
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
        String(g.creatorId?._id || g.creatorId) === userId && 
        g.inviteTargetUserId && 
        !g.members?.some(m => String(m?._id || m) === String(g.inviteTargetUserId))
      );
      setSentRequests(sent);
      setSentPairRequestIds(new Set(
        sent
          .map((g) => String(g?.inviteTargetUserId?._id || g?.inviteTargetUserId || ''))
          .filter(Boolean)
      ));

      if (buddyModeEnabled) {
        const venuesRes = await api.get('/buddies/groups/safe-venues', { params: coords });
        setSafeVenues(venuesRes.data || { redPin: [], publicPlazas: [] });
      } else {
        setSuggestedPeers([]);
        setHasRunPeerMatch(false);
        setSafeVenues({ redPin: [], publicPlazas: [] });
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load buddy data right now.');
    } finally {
      setLoading(false);
    }
  }, [getAnchorCoords, userId, buddyModeEnabled]);

  const searchPeersWithIntent = async (customIntent = null) => {
    if (!buddyModeEnabled) return;
    const coords = getAnchorCoords();
    setError('');
    setMatchingPeers(true);
    setMatchingGroups(true);
    setHasRunPeerMatch(true);
    try {
      const intentToUse = customIntent || peerIntent;
      const [peersRes, groupsRes] = await Promise.all([
        api.get('/buddies/groups/suggested-peers', {
          params: { intent: intentToUse }
        }),
        api.get('/buddies/match', {
          params: { ...coords, intent: intentToUse }
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

  const generateDescriptionFor = async ({ activity, meetingPlace, onSet, onBusy }) => {
    const activityText = String(activity || '').trim();
    if (!activityText) {
      setError('Add intent/activity first.');
      return;
    }
    onBusy(true);
    setError('');
    try {
      const { data } = await api.post('/buddies/generate-description', {
        activity: activityText,
        interests: [],
        meetingPlace: String(meetingPlace || '').trim()
      });
      if (data?.description) onSet(data.description);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not generate description right now.');
    } finally {
      onBusy(false);
    }
  };

  const sendPairRequest = async (peer) => {
    if (!buddyModeEnabled) {
      setError('Turn on Buddy Mode first to send a pair request.');
      return;
    }
    const peerId = String(peer?.id || '');
    if (!peerId || sentPairRequestIds.has(peerId) || sendingPairRequestId === peerId) return;
    const intentText = String(peerIntent || '').trim();
    if (!intentText) {
      setError('Enter intent first.');
      return;
    }
    setSendingPairRequestId(peerId);
    setError('');
    try {
      const coords = getAnchorCoords();
      let redPin = Array.isArray(safeVenues?.redPin) ? safeVenues.redPin : [];
      let publicPlazas = Array.isArray(safeVenues?.publicPlazas) ? safeVenues.publicPlazas : [];
      if (!redPin.length && !publicPlazas.length) {
        const venuesRes = await api.get('/buddies/groups/safe-venues', { params: coords });
        redPin = Array.isArray(venuesRes?.data?.redPin) ? venuesRes.data.redPin : [];
        publicPlazas = Array.isArray(venuesRes?.data?.publicPlazas) ? venuesRes.data.publicPlazas : [];
        setSafeVenues({ redPin, publicPlazas });
      }
      const picked = redPin[0] || publicPlazas[0];
      if (!picked || !Number.isFinite(Number(picked.lat)) || !Number.isFinite(Number(picked.lng))) {
        setError('No safe meetup venue is available near your area yet.');
        return;
      }
      const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await api.post('/buddies/groups', {
        activity: intentText,
        description: '',
        interests: user?.interests || ['hangout'],
        meetingPlace: String(picked.name || 'Safe meetup point').trim(),
        scheduledAt,
        maxMembers: 2,
        lat: coords.lat,
        lng: coords.lng,
        inviteTargetUserId: peerId,
        intentSnippet: intentText,
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
      setSentPairRequestIds((prev) => {
        const next = new Set(prev);
        next.add(peerId);
        return next;
      });
      refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not send pair request.');
    } finally {
      setSendingPairRequestId('');
    }
  };

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    if (loadedUserIdRef.current === userId) return;
    loadedUserIdRef.current = userId;
    setLoading(true);
    refreshData();
  }, [userId, refreshData, loadedUserIdRef]);

  useEffect(() => {
    if (!showCalendarModal) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setShowCalendarModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCalendarModal]);

  const toggleBuddyMode = async () => {
    if (buddyBusy) return;
    const prevMode = buddyModeEnabled;
    const nextMode = !prevMode;
    setBuddyBusy(true);
    setError('');
    // Optimistic UI: flip immediately for snappy toggle.
    updateUser({ buddyMode: nextMode });
    if (!nextMode) {
      setShowPeerSearch(false);
      setShowPairInvite(false);
      setShowAllPairMatches(false);
      setSuggestedPeers([]);
      setHasRunPeerMatch(false);
      setSafeVenues({ redPin: [], publicPlazas: [] });
    }
    try {
      const { data } = await api.put('/users/profile', { buddyMode: nextMode });
      updateUser({ buddyMode: data.buddyMode, interests: data.interests, name: data.name });
      if (data.buddyMode) {
        const coords = getAnchorCoords();
        // Keep toggle responsive; load venue options in background.
        api.get('/buddies/groups/safe-venues', { params: coords })
          .then((venuesRes) => {
            setSafeVenues(venuesRes.data || { redPin: [], publicPlazas: [] });
          })
          .catch(() => {});
      }
    } catch (err) {
      // Revert optimistic toggle on failure.
      updateUser({ buddyMode: prevMode });
      setError(err?.response?.data?.error || 'Could not update Buddy Mode.');
    } finally {
      setBuddyBusy(false);
    }
  };

  const createGroup = async (e) => {
    e.preventDefault();
    if (!buddyModeEnabled) {
      setError('Turn on Buddy Mode first to create a group.');
      return;
    }
    if (!form.meetingPlace.trim()) {
      setError('Please enter and save a meeting place.');
      return;
    }
    const parsedMaxMembers = Number.parseInt(String(form.maxMembers), 10);
    if (!Number.isFinite(parsedMaxMembers) || parsedMaxMembers < 3) {
      setError('Max members should be more than 2.');
      return;
    }
    const ok = window.confirm('Please review details once more. Create this group and send AI-matched invites now?');
    if (!ok) return;
    setSubmitting(true);
    setError('');
    try {
      const coords = getAnchorCoords();
      await api.post('/buddies/groups', {
        ...form,
        maxMembers: parsedMaxMembers,
        description: String(form.description || '').trim(),
        intentSnippet: String(form.activity || '').trim(),
        lat: coords.lat,
        lng: coords.lng,
        safeBy: form.safeBy ? new Date(form.safeBy).toISOString() : undefined
      });
      await refreshData();
      setShowCreate(false);
      setShowPeerSearch(false);
      setMeetingPlaceDraft('');
      setForm({ activity: '', description: '', meetingPlace: '', scheduledAt: '', maxMembers: '', safeBy: '' });
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create the group. Check fields and retry.');
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

  const acceptGroupInvite = async (id) => {
    setActionGroupId(id);
    setError('');
    try {
      await api.post(`/buddies/groups/${id}/accept-invite`);
      await refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not accept group invite.');
    } finally {
      setActionGroupId('');
    }
  };

  const rejectGroupInvite = async (id) => {
    const confirmed = window.confirm('Reject this group invitation?');
    if (!confirmed) return;
    setActionGroupId(id);
    setError('');
    try {
      await api.post(`/buddies/groups/${id}/reject-invite`);
      await refreshData();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not reject group invite.');
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

  const myId = userId;
  const calendarPlans = useMemo(
    () => normalizeBuddyPlans(mergeUniqueGroups(groups, pendingInvites), myId),
    [groups, pendingInvites, myId]
  );
  const rankedSuggestedPeers = useMemo(
    () => [...suggestedPeers].sort((a, b) => Number(b?.matchPercent || 0) - Number(a?.matchPercent || 0)),
    [suggestedPeers]
  );
  const topSuggestedPeers = rankedSuggestedPeers.slice(0, 3);
  const openMatchCount = hasRunPeerMatch ? matches.filter((g) => g?.status === 'open').length : 0;
  const pendingForMe = groups.reduce((sum, g) => sum + (g?.pendingRequests?.length || 0), 0);
  const openPlanOnMap = useCallback((plan) => {
    const lat = Number(plan?.lat);
    const lng = Number(plan?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const query = encodeURIComponent(`${lat},${lng}`);
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="space-y-8 goout-animate-in">
      <div className="goout-glass-card rounded-2xl p-6 md:p-7 goout-hover-lift border border-slate-200">
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
              disabled={!buddyModeEnabled}
              className="goout-btn-primary text-sm py-2 px-4">
              Create group
            </button>
            <button
              type="button"
              onClick={() => openIntentModal('pair')}
              disabled={!buddyModeEnabled}
              className="goout-btn-ghost text-sm py-2 px-3 border-emerald-200/80 text-emerald-800 hover:bg-emerald-50/80 disabled:opacity-60">
              Pair hangout invite
            </button>
          </div>
        </div>
        {!buddyModeEnabled && (
          <p className="mt-3 text-xs text-slate-500">
            Buddy Mode is off. You can still view invites, but creating groups/pair hangouts is locked.
          </p>
        )}
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
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition disabled:opacity-60 ${
              user?.buddyMode ?
                'bg-goout-green text-white border border-emerald-300/40' :
                'bg-slate-800/90 text-slate-100 border border-indigo-300/40 hover:bg-slate-700/90'
            }`}>
            <span
              className={`h-2.5 w-2.5 rounded-full ${user?.buddyMode ? 'bg-emerald-100' : 'bg-slate-500'}`}
              aria-hidden
            />
            <span>Buddy Mode</span>
            <span className="rounded-full border border-current/35 px-2 py-0.5 text-[11px] leading-none tracking-wide">
              {buddyBusy ? 'SAVING' : user?.buddyMode ? 'ON' : 'OFF'}
            </span>
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

      <div className="goout-surface rounded-2xl p-5 border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-semibold text-slate-900">Buddy calendar</h2>
            <p className="text-xs text-slate-600 mt-1">Open your plans in a quick popup view.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCalendarModal(true)}
            className="px-4 py-2 rounded-lg bg-goout-green text-white text-sm font-medium shadow-sm hover:bg-goout-accent transition"
          >
            Open Calendar
          </button>
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
                    onClick={() => (g.inviteType === 'group' ? acceptGroupInvite(g._id) : acceptHangout(g._id))}
                    className="px-4 py-2 bg-goout-green text-white rounded-lg text-sm font-medium disabled:opacity-60">
                    {actionGroupId === g._id ? '…' : g.inviteType === 'group' ? 'Accept invite' : 'Accept hangout'}
                  </button>
                  <button
                    type="button"
                    disabled={actionGroupId === g._id}
                    onClick={() => (g.inviteType === 'group' ? rejectGroupInvite(g._id) : rejectHangout(g._id))}
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

      {user?.buddyMode && showPeerSearch && !showPairInvite && (
        <div className="goout-surface rounded-2xl p-5 border border-slate-200">
          <h2 className="font-display font-semibold text-lg mb-2">Match groups by intent</h2>
          <p className="text-xs text-slate-600 mb-3">
            Enter intent first, then search to find matching open groups.
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
              {matchingPeers ? 'Matching…' : 'Match groups'}
            </button>
          </div>
          <p className="text-sm text-slate-500">
            {loading ? 'Loading suggestions…' : !hasRunPeerMatch ? 'Run matching to see groups.' : 'Groups updated below.'}
          </p>
        </div>
      )}

      {showCreate && !showPairInvite &&
      <div className="goout-surface rounded-2xl p-6">
          <h2 className="font-display font-semibold text-lg mb-4">Create Buddy Group</h2>
          <form onSubmit={createGroup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Intent</label>
              <input
                type="text"
                value={form.activity}
                onChange={(e) => setForm((f) => ({ ...f, activity: e.target.value }))}
                placeholder="e.g. sunset walk + street photography"
                required
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-sm font-medium">Description</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => generateDescriptionFor({
                      activity: form.activity,
                      meetingPlace: form.meetingPlace,
                      onSet: (description) => setForm((f) => ({ ...f, description })),
                      onBusy: setGeneratingDescription
                    })}
                    className="px-2.5 py-1 rounded-md text-xs font-medium border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                    disabled={generatingDescription || !form.activity.trim()}>
                    {generatingDescription ? 'Generating…' : 'Write with AI'}
                  </button>
                </div>
              </div>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Write your own description or use AI."
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                rows="3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max members</label>
              <input
              type="number"
              value={form.maxMembers}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  maxMembers: e.target.value === '' ? '' : Number(e.target.value)
                }))}
              min={3}
              max={20}
              placeholder="3 or more"
              required
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
              {form.maxMembers !== '' && Number(form.maxMembers) < 3 && (
                <p className="text-xs text-red-600 mt-1">Max members should be more than 2.</p>
              )}
              <p className="text-xs text-slate-500 mt-1">We invite top AI matches up to this member limit.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Meeting place</label>
              <div className="flex gap-2">
                <input
                type="text"
                value={meetingPlaceDraft}
                onChange={(e) => setMeetingPlaceDraft(e.target.value)}
                placeholder="Enter place and click Save"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
                <button
                  type="button"
                  onClick={() => {
                    const next = meetingPlaceDraft.trim();
                    if (!next) return;
                    setForm((f) => ({ ...f, meetingPlace: next }));
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-sm font-medium hover:bg-slate-100">
                  Save
                </button>
              </div>
              {form.meetingPlace ? (
                <p className="text-xs text-emerald-700 mt-1">Saved: {form.meetingPlace}</p>
              ) : (
                <p className="text-xs text-slate-500 mt-1">Save a public place only (no private/home addresses).</p>
              )}
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
              <label className="block text-sm font-medium mb-1">Deadline</label>
              <input
              type="datetime-local"
              value={form.safeBy}
              onChange={(e) => setForm((f) => ({ ...f, safeBy: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg" />
              <p className="text-xs text-slate-500 mt-1">Optional safety check-in deadline.</p>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={submitting} className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium disabled:opacity-60">
                {submitting ? 'Creating...' : 'Review & create'}
              </button>
              <button type="button" disabled={submitting} onClick={() => {
                setShowCreate(false);
                setShowPeerSearch(false);
                setMeetingPlaceDraft('');
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
            Matched by your intent + profile fit (interests, prefer, avoid). Top matches are shown first.
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
              {topSuggestedPeers
                .filter((p) => String(p.id) !== String(user?.id || user?._id))
                .map((p, idx) => {
                  const peerId = String(p.id || '');
                  const isSent = sentPairRequestIds.has(peerId);
                  const isSending = sendingPairRequestId === peerId;
                  return (
                    <div key={p.id} className="border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3 bg-white/90">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">
                          #{idx + 1} {p.displayName}
                        </p>
                        <p className="text-sm text-slate-600">
                          Match: <span className="font-semibold text-goout-green">{Number(p.matchPercent || 0)}%</span>
                          {' · '}
                          Profile fit: {Number(p.preferencePercent || 0)}%
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Intent: {Number(p.intentPercent || p.matchPercent || 0)}%
                          {p.interests?.length ? ` · ${p.interests.join(', ')}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => sendPairRequest(p)}
                        disabled={isSent || isSending || !buddyModeEnabled}
                        className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap disabled:opacity-60 ${
                          isSent ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-goout-green text-white hover:bg-goout-green/90'
                        }`}
                      >
                        {isSending ? 'Sending…' : isSent ? 'Request Sent' : 'Send Request'}
                      </button>
                    </div>
                  );
                })}
              {rankedSuggestedPeers.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllPairMatches(true)}
                  className="text-sm font-semibold text-emerald-700 hover:text-emerald-500 underline underline-offset-4"
                >
                  View all matches ({rankedSuggestedPeers.length})
                </button>
              )}
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
                  <div className="mt-3">
                    <Link to={`/app/group/${g._id}`} className="inline-flex px-3 py-1.5 text-sm rounded-lg bg-goout-green text-white font-medium hover:bg-goout-accent text-center">
                      Open Chat
                    </Link>
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

      {showAllPairMatches && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close all matches panel"
            onClick={() => setShowAllPairMatches(false)}
            className="absolute inset-0 bg-black/45"
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-emerald-300/40 bg-[#0f2c1e] p-5 shadow-2xl overflow-y-auto goout-animate-in">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h3 className="font-display text-lg font-semibold text-emerald-50">All matched explorers</h3>
              <button
                type="button"
                onClick={() => setShowAllPairMatches(false)}
                className="rounded-lg border border-emerald-300/40 px-2.5 py-1 text-sm text-emerald-100 hover:bg-emerald-500/20"
              >
                Close
              </button>
            </div>
            <div className="space-y-3">
              {rankedSuggestedPeers
                .filter((p) => String(p.id) !== String(user?.id || user?._id))
                .map((p, idx) => {
                  const peerId = String(p.id || '');
                  const isSent = sentPairRequestIds.has(peerId);
                  const isSending = sendingPairRequestId === peerId;
                  return (
                    <div key={peerId} className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-3">
                      <p className="font-semibold text-emerald-50">#{idx + 1} {p.displayName}</p>
                      <p className="text-xs text-emerald-100/85 mt-1">
                        Match {Number(p.matchPercent || 0)}% · Intent {Number(p.intentPercent || 0)}% · Profile {Number(p.preferencePercent || 0)}%
                      </p>
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => sendPairRequest(p)}
                          disabled={isSent || isSending || !buddyModeEnabled}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60 ${
                            isSent ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-600 text-white hover:bg-emerald-500'
                          }`}
                        >
                          {isSending ? 'Sending…' : isSent ? 'Request Sent' : 'Send Request'}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </aside>
        </div>
      )}

      {showCalendarModal && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close calendar popup"
            onClick={() => setShowCalendarModal(false)}
            className="absolute inset-0 bg-slate-950/50 transition-opacity duration-300 opacity-100"
          />
          <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-emerald-200/40 bg-white p-5 shadow-2xl transition-all duration-300 opacity-100 scale-100 goout-animate-in">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold text-slate-900">Your buddy calendar</h3>
              <button
                type="button"
                onClick={() => setShowCalendarModal(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto">
              <ExplorerCalendar
                plans={calendarPlans}
                loading={loading}
                onRefresh={refreshData}
                onOpenPlanMap={openPlanOnMap}
              />
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
