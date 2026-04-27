import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import api, { getAssetUrl } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

function businessIdFromUser(user) {
  if (!user?.businessId) return null;
  return user.businessId._id || user.businessId;
}

function parseTags(line) {
  return line.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

function toId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
}

function computeBuddySocialStats(groups, myId) {
  const me = String(myId || '');
  if (!me) return { groupsJoined: 0, friendsCount: 0 };
  const joinedGroups = (Array.isArray(groups) ? groups : []).filter((g) =>
    Array.isArray(g?.members) && g.members.some((m) => toId(m) === me)
  );
  const friendIds = new Set();
  joinedGroups.forEach((g) => {
    if (toId(g?.creatorId) && toId(g.creatorId) !== me) {
      friendIds.add(toId(g.creatorId));
    }
    (Array.isArray(g?.members) ? g.members : []).forEach((m) => {
      const id = toId(m);
      if (id && id !== me) friendIds.add(id);
    });
  });
  return {
    groupsJoined: joinedGroups.length,
    friendsCount: friendIds.size
  };
}

export default function Profile() {
  const { user, refreshUser, logout } = useAuth();
  const { addToast } = useToast();
  const isMerchant = user?.role === 'merchant';
  const bid = businessIdFromUser(user);

  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingExplorer, setSavingExplorer] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);

  const [name, setName] = useState('');
  const [interestsLine, setInterestsLine] = useState('');
  const [weight, setWeight] = useState('');
  const [emergencyEmailsLine, setEmergencyEmailsLine] = useState('');
  const [buddyMode, setBuddyMode] = useState(false);
  const [preferLine, setPreferLine] = useState('');
  const [avoidLine, setAvoidLine] = useState('');
  const [discoveryNotes, setDiscoveryNotes] = useState('');

  const [bizName, setBizName] = useState('');
  const [bizPhone, setBizPhone] = useState('');
  const [bizContactEmail, setBizContactEmail] = useState('');
  const [bizDescription, setBizDescription] = useState('');
  const [bizVibe, setBizVibe] = useState('');
  const [bizAddress, setBizAddress] = useState('');
  const [bizWebsite, setBizWebsite] = useState('');
  const [bizInstagram, setBizInstagram] = useState('');
  const [bizFacebook, setBizFacebook] = useState('');
  const [groupsJoined, setGroupsJoined] = useState(0);
  const [friendsCount, setFriendsCount] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const u = await refreshUser();
      if (!u) {
        addToast({ type: 'error', title: 'Could not load profile', message: 'Try signing in again.' });
        return;
      }
      const roleMerchant = u.role === 'merchant';
      setName(u.name || '');
      setAvatarUrl(String(u.avatar || '').trim());
      setInterestsLine(Array.isArray(u.interests) ? u.interests.join(', ') : '');
      setWeight(u.weight != null ? String(u.weight) : '');
      const emergencyEmails = Array.isArray(u.emergencyEmails) ? u.emergencyEmails : [];
      setEmergencyEmailsLine(emergencyEmails.join(', '));
      setBuddyMode(Boolean(u.buddyMode));
      if (!roleMerchant) {
        try {
          const { data: buddyGroups } = await api.get('/buddies/groups');
          const stats = computeBuddySocialStats(buddyGroups, u.id || u._id);
          setGroupsJoined(stats.groupsJoined);
          setFriendsCount(stats.friendsCount);
        } catch {
          setGroupsJoined(0);
          setFriendsCount(0);
        }
      } else {
        setGroupsJoined(0);
        setFriendsCount(0);
      }
      if (!roleMerchant) {
        try {
          const { data } = await api.get('/users/discovery-preferences');
          setPreferLine((data.prefer || []).join(', '));
          setAvoidLine((data.avoid || []).join(', '));
          setDiscoveryNotes(data.notes || '');
        } catch {
          setPreferLine('');
          setAvoidLine('');
          setDiscoveryNotes('');
        }
      }
      const id = businessIdFromUser(u);
      if (roleMerchant && id) {
        const { data: b } = await api.get(`/businesses/${id}`);
        setBizName(b.name || '');
        setBizPhone(b.phone || '');
        setBizContactEmail(b.contactEmail || '');
        setBizDescription(b.description || '');
        setBizVibe(b.vibe || '');
        setBizAddress(b.address || '');
        setBizWebsite(b.socialLinks?.website || '');
        setBizInstagram(b.socialLinks?.instagram || '');
        setBizFacebook(b.socialLinks?.facebook || '');
      }
    } catch (e) {
      addToast({ type: 'error', title: 'Could not load profile', message: e?.response?.data?.error || 'Try again.' });
    } finally {
      setLoading(false);
    }
  }, [refreshUser, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const saveAccount = async (e) => {
    e.preventDefault();
    setSavingAccount(true);
    try {
      const body = { name: name.trim(), avatar: avatarUrl };
      if (!isMerchant) {
        const emergencyEmails = parseTags(emergencyEmailsLine).map((s) => s.toLowerCase());
        if (emergencyEmails.length < 1 || emergencyEmails.length > 3) {
          addToast({
            type: 'error',
            title: 'Emergency emails required',
            message: 'Please add at least 1 and at most 3 emergency family emails.'
          });
          setSavingAccount(false);
          return;
        }
        body.interests = parseTags(interestsLine);
        const w = parseFloat(weight);
        if (Number.isFinite(w)) body.weight = w;
        body.emergencyEmails = emergencyEmails;
        body.buddyMode = buddyMode;
      }
      await api.put('/users/profile', body);
      await refreshUser();
      addToast({ type: 'success', title: 'Saved', message: 'Your account details were updated.' });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Save failed',
        message: err?.response?.data?.error || 'Could not update profile.'
      });
    } finally {
      setSavingAccount(false);
    }
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/uploads/profile-avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const nextAvatar = String(data?.url || '').trim();
      if (!nextAvatar) throw new Error('Upload failed');
      setAvatarUrl(nextAvatar);
      await api.put('/users/profile', { avatar: nextAvatar });
      await refreshUser();
      addToast({ type: 'success', title: 'Photo updated', message: 'Your profile photo is now visible in chat.' });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Upload failed',
        message: err?.response?.data?.error || err?.message || 'Could not upload profile photo.'
      });
    } finally {
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      setAvatarUploading(false);
    }
  };

  const saveDiscovery = async (e) => {
    e.preventDefault();
    setSavingExplorer(true);
    try {
      await api.put('/users/discovery-preferences', {
        prefer: parseTags(preferLine),
        avoid: parseTags(avoidLine),
        notes: discoveryNotes
      });
      addToast({ type: 'success', title: 'Saved', message: 'Discovery preferences updated for the concierge.' });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Save failed',
        message: err?.response?.data?.error || 'Could not save preferences.'
      });
    } finally {
      setSavingExplorer(false);
    }
  };

  const saveBusiness = async (e) => {
    e.preventDefault();
    if (!bid) return;
    setSavingBusiness(true);
    try {
      await api.put(`/businesses/${bid}`, {
        name: bizName.trim(),
        phone: bizPhone.trim(),
        contactEmail: bizContactEmail.trim(),
        description: bizDescription,
        vibe: bizVibe.trim(),
        address: bizAddress.trim(),
        socialLinks: {
          website: bizWebsite.trim(),
          instagram: bizInstagram.trim(),
          facebook: bizFacebook.trim()
        }
      });
      addToast({ type: 'success', title: 'Business updated', message: 'Your public listing details were saved.' });
      await refreshUser();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Save failed',
        message: err?.response?.data?.error || 'Could not update business.'
      });
    } finally {
      setSavingBusiness(false);
    }
  };

  function getInitials(fullName) {
    const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = words[0]?.[0] || '';
    const second = words[1]?.[0] || '';
    return `${first}${second}`.toUpperCase() || '?';
  }

  const handleLogout = () => {
    addToast({ type: 'info', title: 'Logged out', message: 'See you soon.' });
    logout();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 goout-animate-in">
        <div className="h-12 w-12 rounded-full border-2 border-goout-green/30 border-t-goout-green animate-spin" />
        <p className="text-slate-600 text-sm">Loading your profile…</p>
      </div>
    );
  }

  const bizPopulated = user?.businessId && typeof user.businessId === 'object';
  const linkedBizName = bizPopulated ? user.businessId.name : '';
  const linkedBizCategory = bizPopulated ? user.businessId.category : '';
  const linkedBizAddress = bizPopulated ? user.businessId.address : '';
  const interestCount = parseTags(interestsLine).length;
  const preferCount = parseTags(preferLine).length;
  const avoidCount = parseTags(avoidLine).length;
  const profileCompleteness = isMerchant ?
    (name.trim() ? 40 : 0) + (bizName.trim() ? 30 : 0) + (bizDescription.trim() ? 30 : 0) :
    (name.trim() ? 34 : 0) + (interestCount > 0 ? 33 : 0) + (preferCount > 0 ? 33 : 0);
  const safeCompleteness = Math.min(100, profileCompleteness);
  const displayInitials = getInitials(name || user?.name);

  return (
    <div className="w-full space-y-7 pb-16 goout-animate-in">
      <div className="goout-profile-hero relative overflow-hidden rounded-[2rem] border border-orange-100/80 p-5 shadow-dock md:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-orange-300/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="relative grid items-center gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="goout-animate-stagger space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-orange-700 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_16px_rgba(16,185,129,0.8)]" />
              {isMerchant ? 'Merchant Control Center' : 'Explorer Control Center'}
            </div>
            <div>
              <h1 className="font-display text-3xl font-black tracking-tight text-slate-950 sm:text-4xl md:text-5xl">
                Your profile, upgraded
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-slate-700 md:text-base">
                {isMerchant
                  ? 'Tune your public identity, listing confidence, and storefront details from one clean command space.'
                  : 'Shape your explorer identity, safety layer, buddy network, and AI concierge preferences in one polished workspace.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="goout-profile-chip">Completeness {safeCompleteness}%</span>
              <span className="goout-profile-chip">{isMerchant ? (bid ? 'Listing linked' : 'Listing pending') : `${groupsJoined} groups`}</span>
              <span className="goout-profile-chip">{isMerchant ? 'Storefront tools' : `${friendsCount} friends`}</span>
            </div>
          </div>

          <div className="goout-profile-score-card rounded-[1.6rem] border border-white/70 bg-white/78 p-5 shadow-xl shadow-orange-950/10 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Profile power</p>
                <p className="mt-1 text-4xl font-black text-slate-950">{safeCompleteness}%</p>
              </div>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-emerald-500 text-xl font-black text-white shadow-lg shadow-orange-500/20">
                {displayInitials}
              </div>
            </div>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-orange-500 via-amber-400 to-emerald-500 transition-all duration-500"
                style={{ width: `${safeCompleteness}%` }}
              />
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-600">
              {safeCompleteness >= 100 ? 'Everything looks sharp.' : 'Add a few more details to make the profile feel complete.'}
            </p>
          </div>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="goout-profile-stat rounded-3xl p-5">
          <span className="goout-profile-stat-icon">01</span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Profile Score</p>
          <p className="mt-1 text-3xl font-black text-slate-950">{safeCompleteness}%</p>
        </div>
        <div className="goout-profile-stat rounded-3xl p-5">
          <span className="goout-profile-stat-icon">02</span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{isMerchant ? 'Listing Mode' : 'Buddy Mode'}</p>
          <p className="mt-1 text-3xl font-black text-slate-950">{isMerchant ? (bid ? 'Live' : 'Setup') : (buddyMode ? 'On' : 'Off')}</p>
        </div>
        <div className="goout-profile-stat rounded-3xl p-5">
          <span className="goout-profile-stat-icon">03</span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{isMerchant ? 'Business Status' : 'Groups Joined'}</p>
          <p className="mt-1 text-3xl font-black text-slate-950">
            {isMerchant ? (bid ? 'Linked' : 'Pending') : groupsJoined}
          </p>
        </div>
        <div className="goout-profile-stat rounded-3xl p-5 flex items-center justify-between gap-3">
          <div>
            <span className="goout-profile-stat-icon">04</span>
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{isMerchant ? 'Quick Action' : 'Friends'}</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">{isMerchant ? 'Open Merchant Hub' : `${friendsCount} total`}</p>
          </div>
          {isMerchant ?
          <Link to="/app/merchant" className="goout-btn-primary text-sm py-2 px-3">
              Open
            </Link> :
          <Link to="/app/buddies" className="goout-btn-primary text-sm py-2 px-3">
              View
            </Link>
          }
        </div>
      </section>

      <section className="goout-profile-identity rounded-[2rem] p-5 md:p-7">
        <div className="grid gap-6 lg:grid-cols-[auto_1fr_auto] lg:items-center">
          <div className="relative shrink-0">
            {avatarUrl ? (
              <img
                src={getAssetUrl(avatarUrl)}
                alt="Profile avatar"
                className="h-24 w-24 rounded-[1.6rem] border-4 border-white object-cover shadow-2xl shadow-emerald-500/20"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-[1.6rem] border-4 border-white bg-gradient-to-br from-orange-500 via-amber-500 to-emerald-500 text-3xl font-black text-white shadow-2xl shadow-orange-500/20">
                {displayInitials}
              </div>
            )}
            <span className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-emerald-500 text-xs font-black text-white shadow-lg">
              ✓
            </span>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => uploadAvatar(e.target.files?.[0])}
            />
          </div>
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2 gap-y-2">
              <h2 className="font-display text-2xl font-black text-slate-950 truncate md:text-3xl">{user?.name || 'Member'}</h2>
              <span className={`goout-role-pill ${isMerchant ? 'goout-role-pill--merchant' : 'goout-role-pill--explorer'}`}>
                {isMerchant ? 'Merchant' : 'Explorer'}
              </span>
              {user?.verified &&
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800">Verified</span>
              }
            </div>
            <p className="rounded-2xl border border-slate-200/80 bg-white/72 px-3 py-2 text-sm font-semibold text-slate-600 break-all">
              <span className="goout-label !inline mr-2">Email</span>
              {user?.email || '—'}
            </p>
            <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-1">Role: {isMerchant ? 'Merchant' : 'Explorer'}</span>
              <span className="rounded-full bg-orange-50 px-3 py-1 text-orange-700">Score: {safeCompleteness}%</span>
              {!isMerchant && <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">Buddy: {buddyMode ? 'Enabled' : 'Disabled'}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                className="goout-btn-ghost text-xs px-3 py-1.5"
              >
                {avatarUploading ? 'Uploading photo…' : avatarUrl ? 'Change photo' : 'Upload photo'}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  disabled={avatarUploading}
                  onClick={async () => {
                    setAvatarUrl('');
                    try {
                      await api.put('/users/profile', { avatar: '' });
                      await refreshUser();
                      addToast({ type: 'success', title: 'Photo removed', message: 'Initials avatar is active now.' });
                    } catch (err) {
                      addToast({
                        type: 'error',
                        title: 'Could not remove photo',
                        message: err?.response?.data?.error || 'Please try again.'
                      });
                    }
                  }}
                  className="goout-btn-ghost text-xs px-3 py-1.5 border-red-200 text-red-700 hover:bg-red-50"
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>
          <div className="rounded-[1.4rem] border border-orange-100 bg-white/75 p-4 shadow-sm lg:min-w-[14rem]">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Next best action</p>
            <p className="mt-2 text-sm font-semibold leading-5 text-slate-700">
              {isMerchant
                ? bid ? 'Keep your storefront details fresh so explorers trust your listing.' : 'Register your storefront to unlock the merchant profile tools.'
                : preferCount > 0 ? 'Your concierge has enough taste data to personalize picks.' : 'Add preferences so the AI concierge can recommend better places.'}
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {!isMerchant && user?.greenStats && (
              <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-emerald-900 mb-2 text-xs uppercase tracking-wide">Green mode (activity)</p>
                <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs sm:text-sm">
                  <li>Walks: <strong className="text-slate-900">{user.greenStats.totalWalks ?? 0}</strong></li>
                  <li>Calories: <strong className="text-slate-900">{user.greenStats.totalCaloriesBurned ?? 0}</strong></li>
                  <li>CO₂ saved: <strong className="text-slate-900">{user.greenStats.totalCO2Saved ?? 0}</strong> g</li>
                </ul>
              </div>
            )}
            {isMerchant && (
              <div className="rounded-2xl border border-amber-200/70 bg-amber-50/50 px-4 py-3 text-sm text-slate-700 lg:col-span-2">
                <p className="font-semibold text-amber-900/90 mb-1 text-xs uppercase tracking-wide">Business link</p>
                {bid ? (
                  <>
                    <p className="font-medium text-slate-900">{linkedBizName || bizName || 'Your storefront'}</p>
                    {linkedBizCategory && <p className="text-xs text-slate-600 mt-0.5">Category: {linkedBizCategory}</p>}
                    {linkedBizAddress && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{linkedBizAddress}</p>}
                    <p className="text-xs text-emerald-800 mt-2">Use the form below to edit listing fields explorers see.</p>
                  </>
                ) : (
                  <p className="text-sm">No business linked yet. Open the Merchant tab to register your storefront, then return here to edit details.</p>
                )}
              </div>
            )}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-12">
      <form onSubmit={saveAccount} className="goout-profile-panel rounded-[2rem] p-6 md:p-8 space-y-5 goout-hover-lift xl:col-span-7">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="font-display text-lg font-semibold text-slate-900">Account &amp; safety settings</h2>
          <span
            className={`goout-role-pill ${isMerchant ? 'goout-role-pill--merchant' : 'goout-role-pill--explorer'}`}>
            {isMerchant ? 'Merchant' : 'Explorer'}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="goout-label">Display name</span>
            <input
              className="goout-input mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="goout-label">Email</span>
            <input className="goout-input mt-1 opacity-80 cursor-not-allowed" value={user?.email || ''} readOnly />
            <span className="text-xs text-slate-500 mt-1 block">Email cannot be changed here.</span>
          </label>
        </div>

        {!isMerchant && (
          <>
            <label className="block">
              <span className="goout-label">Interests (comma-separated)</span>
              <input
                className="goout-input mt-1"
                value={interestsLine}
                onChange={(e) => setInterestsLine(e.target.value)}
                placeholder="coffee, live music, hiking…"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="goout-label">Weight (kg)</span>
                <input
                  className="goout-input mt-1"
                  type="number"
                  min="20"
                  max="300"
                  step="0.1"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="65"
                />
                <span className="text-xs text-slate-500 mt-1 block">
                  Used for visit calorie estimates and shown read-only in Green Mode — change it only here.
                </span>
              </label>
              <label className="block">
                <span className="goout-label">Emergency family emails (1 to 3)</span>
                <input
                  className="goout-input mt-1"
                  value={emergencyEmailsLine}
                  onChange={(e) => setEmergencyEmailsLine(e.target.value)}
                  placeholder="family1@email.com, family2@email.com"
                />
                <span className="text-xs text-slate-500 mt-1 block">
                  SOS will email your current location to these addresses.
                </span>
              </label>
            </div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-goout-green focus:ring-goout-green"
                checked={buddyMode}
                onChange={(e) => setBuddyMode(e.target.checked)}
              />
              <span className="text-sm text-slate-700 group-hover:text-slate-900 transition-colors">
                Buddy mode — show me peer suggestions and safe venues
              </span>
            </label>
          </>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <button type="submit" className="goout-btn-primary" disabled={savingAccount}>
            {savingAccount ? 'Saving…' : 'Save account'}
          </button>
          <button type="button" className="goout-btn-ghost" onClick={load}>
            Reload
          </button>
        </div>
      </form>

      {!isMerchant && (
        <form onSubmit={saveDiscovery} className="goout-profile-panel rounded-[2rem] p-6 md:p-8 space-y-5 goout-hover-lift xl:col-span-5">
          <h2 className="font-display text-lg font-semibold text-slate-900">Discovery &amp; concierge</h2>
          <p className="text-sm text-slate-600">
            Short chips help the AI concierge bias recommendations. Separate items with commas.
          </p>
          <label className="block">
            <span className="goout-label">Prefer</span>
            <input
              className="goout-input mt-1"
              value={preferLine}
              onChange={(e) => setPreferLine(e.target.value)}
              placeholder="quiet spots, vegetarian, indie bookstores…"
            />
          </label>
          <label className="block">
            <span className="goout-label">Avoid</span>
            <input
              className="goout-input mt-1"
              value={avoidLine}
              onChange={(e) => setAvoidLine(e.target.value)}
              placeholder="loud bars, chains, stairs…"
            />
          </label>
          <label className="block">
            <span className="goout-label">Notes for concierge</span>
            <textarea
              className="goout-input mt-1 min-h-[100px] resize-y"
              value={discoveryNotes}
              onChange={(e) => setDiscoveryNotes(e.target.value)}
              maxLength={800}
              placeholder="Anything else we should keep in mind…"
            />
          </label>
          <button type="submit" className="goout-btn-primary" disabled={savingExplorer}>
            {savingExplorer ? 'Saving…' : 'Save discovery preferences'}
          </button>
        </form>
      )}

      {isMerchant && (
        <div className="goout-profile-panel rounded-[2rem] p-6 md:p-8 space-y-6 goout-hover-lift xl:col-span-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="font-display text-lg font-semibold text-slate-900">Business listing</h2>
            {!bid && (
              <Link to="/app/merchant" className="goout-btn-primary text-sm py-2 px-4 inline-flex">
                Register business
              </Link>
            )}
          </div>
          {!bid ? (
            <p className="text-sm text-slate-600">
              You don&apos;t have a business linked yet. Open the merchant dashboard to create your storefront; then
              return here to fine-tune public details.
            </p>
          ) : (
            <form onSubmit={saveBusiness} className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Keep this section updated — these values are visible to explorers on map cards and listing surfaces.
              </div>
              <label className="block">
                <span className="goout-label">Business name</span>
                <input className="goout-input mt-1" value={bizName} onChange={(e) => setBizName(e.target.value)} required />
              </label>
              <label className="block">
                <span className="goout-label">Public description</span>
                <textarea
                  className="goout-input mt-1 min-h-[100px] resize-y"
                  value={bizDescription}
                  onChange={(e) => setBizDescription(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="goout-label">Vibe</span>
                <input className="goout-input mt-1" value={bizVibe} onChange={(e) => setBizVibe(e.target.value)} />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="goout-label">Phone</span>
                  <input className="goout-input mt-1" value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} />
                </label>
                <label className="block">
                  <span className="goout-label">Contact email</span>
                  <input
                    type="email"
                    className="goout-input mt-1"
                    value={bizContactEmail}
                    onChange={(e) => setBizContactEmail(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className="goout-label">Address (shown to explorers)</span>
                <input className="goout-input mt-1" value={bizAddress} onChange={(e) => setBizAddress(e.target.value)} />
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="goout-label">Website</span>
                  <input className="goout-input mt-1" value={bizWebsite} onChange={(e) => setBizWebsite(e.target.value)} />
                </label>
                <label className="block">
                  <span className="goout-label">Instagram</span>
                  <input
                    className="goout-input mt-1"
                    value={bizInstagram}
                    onChange={(e) => setBizInstagram(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="goout-label">Facebook</span>
                  <input
                    className="goout-input mt-1"
                    value={bizFacebook}
                    onChange={(e) => setBizFacebook(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <button type="submit" className="goout-btn-primary" disabled={savingBusiness}>
                  {savingBusiness ? 'Saving…' : 'Save business profile'}
                </button>
                <Link to="/app/merchant" className="goout-btn-ghost inline-flex items-center">
                  Full merchant dashboard
                </Link>
              </div>
              <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                Customer menu with prices &amp; PDF (shown as &quot;View menu&quot; on the map):{' '}
                <Link to="/app/merchant" className="text-goout-green font-semibold underline">
                  Merchant → Customer menu
                </Link>
              </p>
            </form>
          )}
        </div>
      )}
      </div>

      <section className="goout-glass-card rounded-3xl p-6 md:p-8 border border-slate-200">
        <h2 className="font-display text-lg font-semibold text-slate-900 mb-2">Session</h2>
        <p className="text-sm text-slate-600 mb-4">Sign out on this device. You can sign in again anytime.</p>
        <button type="button" onClick={handleLogout} className="goout-btn-ghost border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300">
          Log out
        </button>
      </section>
    </div>
  );
}
