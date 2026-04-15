import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function GroupChat() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [socket, setSocket] = useState(null);
  const [sockMsg, setSockMsg] = useState('');
  const [walkEtaMin, setWalkEtaMin] = useState(null);
  const [etaBusy, setEtaBusy] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [showLocationConfirm, setShowLocationConfirm] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  const chatExpired = useMemo(() => {
    if (!group?.chatExpiresAt) return false;
    return new Date(group.chatExpiresAt) < new Date();
  }, [group?.chatExpiresAt]);

  const showPostMeetup = useMemo(() => {
    if (!group?.scheduledAt) return false;
    return new Date() >= new Date(group.scheduledAt);
  }, [group?.scheduledAt]);

  const myFeedback = useMemo(() => {
    const uid = String(user?.id || user?._id || '');
    return (group?.postMeetupFeedback || []).find((f) => String(f.userId?._id || f.userId) === uid);
  }, [group?.postMeetupFeedback, user]);

  useEffect(() => {
    api.get(`/buddies/groups/${groupId}`).then(({ data }) => setGroup(data)).catch(console.error);
    api.get(`/chat/${groupId}`).then(({ data }) => setMessages(data)).catch(console.error);
  }, [groupId]);

  useEffect(() => {
    const token = localStorage.getItem('goout_token');
    if (!token) return;
    const s = io(window.location.origin, { auth: { token } });
    s.on('connect', () => {
      s.emit('join-group', groupId);
    });
    s.on('new-message', (msg) => setMessages((m) => [...m, msg]));
    s.on('sos', ({ message }) => setMessages((m) => [...m, { ...message, isSOS: true }]));
    s.on('chat-error', ({ message }) => setSockMsg(message || 'Could not send'));
    setSocket(s);
    return () => {
      s.emit('leave-group', groupId);
      s.disconnect();
    };
  }, [groupId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchWalkEta = () => {
    const dest = group?.safeVenue;
    if (!dest?.lat || !dest?.lng) return;
    setEtaBusy(true);
    setWalkEtaMin(null);
    setSockMsg('');
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try {
          const { data } = await api.post('/directions/route', {
            origin: { lat: p.coords.latitude, lng: p.coords.longitude },
            destination: { lat: dest.lat, lng: dest.lng },
            profile: 'walking',
            alternatives: false,
            maxAlternatives: 1
          });
          const sec = data?.routes?.[0]?.durationSeconds;
          if (Number.isFinite(sec)) setWalkEtaMin(Math.max(1, Math.round(sec / 60)));
          else setSockMsg('Could not get walking time.');
        } catch {
          setSockMsg('ETA lookup failed.');
        } finally {
          setEtaBusy(false);
        }
      },
      () => {
        setEtaBusy(false);
        setSockMsg('Allow location to see your walking ETA to the meetup pin (only duration is shown, not your path).');
      }
    );
  };

  const send = () => {
    if (!input.trim() || !socket || chatExpired) return;
    setSockMsg('');
    socket.emit('chat-message', { groupId, message: input.trim() });
    setInput('');
  };

  const uploadFile = async (file) => {
    if (!file || !socket || chatExpired) return;
    
    setUploading(true);
    setSockMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const { data } = await api.post(`/chat/${groupId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      // Message is already emitted via socket from backend
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setSockMsg(err?.response?.data?.error || 'File upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const confirmLeaveGroup = async () => {
    setLeavingGroup(true);
    setSockMsg('');
    try {
      await api.post(`/buddies/groups/${groupId}/leave`);
      // Disconnect socket and navigate back
      socket?.disconnect();
      window.location.href = '/app/buddies';
    } catch (err) {
      setSockMsg(err?.response?.data?.error || 'Could not leave group');
      setShowLeaveConfirm(false);
    } finally {
      setLeavingGroup(false);
    }
  };

  const sendSOS = () => {
    if (!socket || chatExpired) return;
    setSockMsg('');
    navigator.geolocation.getCurrentPosition(
      (p) => socket.emit('sos', { groupId, lat: p.coords.latitude, lng: p.coords.longitude }),
      () => socket.emit('sos', { groupId })
    );
  };

  const confirmShareLocation = () => {
    setSharingLocation(true);
    setSockMsg('');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const mapUrl = `https://www.google.com/maps?q=${p.coords.latitude},${p.coords.longitude}`;
        socket?.emit('chat-message', { 
          groupId, 
          message: `📍 My location: ${mapUrl}`,
          hasLocation: true,
          lat: p.coords.latitude,
          lng: p.coords.longitude
        });
        setShowLocationConfirm(false);
        setSharingLocation(false);
      },
      () => {
        setSockMsg('Could not access your location. Please check permissions.');
        setShowLocationConfirm(false);
        setSharingLocation(false);
      }
    );
  };

  const submitPostMeetup = async (payload) => {
    setFeedbackBusy(true);
    setSockMsg('');
    try {
      const { data } = await api.post(`/buddies/groups/${groupId}/post-meetup`, payload);
      setGroup((g) => (g ? { ...g, postMeetupFeedback: data.postMeetupFeedback, carbonMeetupBonusAwarded: data.carbonMeetupBonusAwarded } : g));
    } catch (e) {
      setSockMsg(e?.response?.data?.error || 'Could not save feedback.');
    } finally {
      setFeedbackBusy(false);
    }
  };

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 goout-animate-in">
        <div className="h-10 w-10 rounded-full border-2 border-goout-green/30 border-t-goout-green animate-spin" />
        <p className="text-slate-600 text-sm">Loading chat…</p>
      </div>
    );
  }

  const venue = group.safeVenue;
  const mapsMeetUrl = venue?.lat && venue?.lng
    ? `https://www.google.com/maps?q=${venue.lat},${venue.lng}`
    : null;

  return (
    <div className="max-w-3xl mx-auto space-y-4 goout-animate-in">
      <Link
        to="/app/buddies"
        className="goout-btn-ghost text-sm py-2 px-3 inline-flex border-slate-200 hover:border-emerald-300/50">
        ← Back to Buddies
      </Link>

      {venue?.name && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-slate-800">
          <p className="font-semibold text-emerald-900">Safe meetup pin</p>
          <p className="mt-1">
            {venue.name}
            {' '}
            ({venue.kind === 'red_pin' ? 'Red Pin partner' : 'Public place'})
          </p>
          <p className="text-xs text-slate-600 mt-2">
            For your safety, meet only at this pinned location — busy, public, and suitable for a first hello. We never share your live route; you can check walking time below.
          </p>
          {mapsMeetUrl && (
            <a href={mapsMeetUrl} target="_blank" rel="noreferrer" className="inline-block mt-2 text-goout-green font-medium text-sm underline">
              Open meetup location in Google Maps
            </a>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={etaBusy || chatExpired}
              onClick={fetchWalkEta}
              className="px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-sm font-medium text-emerald-900 disabled:opacity-50">
              {etaBusy ? 'Calculating…' : 'My walking ETA to pin'}
            </button>
            {walkEtaMin != null && (
              <span className="text-sm text-emerald-900 font-medium">About {walkEtaMin} min walking (estimate only)</span>
            )}
          </div>
        </div>
      )}

      {chatExpired && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This buddy chat expired two hours after the scheduled meetup time. You can still read history; new messages are disabled.
        </div>
      )}

      {sockMsg && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{sockMsg}</div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col h-[600px]">
        <div className="p-4 border-b flex flex-wrap justify-between items-center gap-2">
          <div>
            <h2 className="font-display font-semibold text-lg">{group.activity}</h2>
            <p className="text-sm text-slate-600">
              {group.members?.length || 0} members · {new Date(group.scheduledAt).toLocaleString()}
            </p>
            {group.chatExpiresAt && (
              <p className="text-xs text-slate-500 mt-1">Chat closes: {new Date(group.chatExpiresAt).toLocaleString()}</p>
            )}
          </div>
          <div className="flex gap-2">
            {group.safeBy && String(group.safeByUserId) === String(user?.id || user?._id) && new Date(group.safeBy) > new Date() &&
            <button type="button" onClick={() => api.post(`/buddies/groups/${groupId}/safe`).then(() => setGroup((g) => ({ ...g, safeBy: null })))} className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium text-sm">
                I&apos;m Safe
              </button>
            }
            <button type="button" onClick={sendSOS} disabled={chatExpired} className="px-4 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 text-sm disabled:opacity-50">
              SOS — need help
            </button>
            <button type="button" onClick={() => setShowLocationConfirm(true)} disabled={chatExpired} className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 text-sm disabled:opacity-50">
              📍 Share Location
            </button>
            <button 
              type="button" 
              onClick={() => setShowLeaveConfirm(true)}
              className="px-4 py-2 bg-slate-400 text-white rounded-lg font-medium hover:bg-slate-500 text-sm"
            >
              Leave group
            </button>
          </div>
        </div>

        {showPostMeetup && (
          <div className="px-4 py-3 border-b bg-slate-50 text-sm">
            <p className="font-medium text-slate-800">After meetup</p>
            {myFeedback ? (
              <p className="text-slate-600 mt-1">Thanks — your check-in was saved.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={feedbackBusy}
                  onClick={() => submitPostMeetup({ didMeet: true, locationSafe: true, walkedThere: true })}
                  className="px-3 py-1.5 rounded-lg bg-goout-green text-white text-xs font-medium disabled:opacity-60">
                  We met · felt safe · walked
                </button>
                <button
                  type="button"
                  disabled={feedbackBusy}
                  onClick={() => submitPostMeetup({ didMeet: true, locationSafe: true, walkedThere: false })}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium disabled:opacity-60">
                  Met · safe · did not walk
                </button>
                <button
                  type="button"
                  disabled={feedbackBusy}
                  onClick={() => submitPostMeetup({ didMeet: false, locationSafe: false, walkedThere: false })}
                  className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-medium disabled:opacity-60">
                  Did not meet / felt unsafe
                </button>
              </div>
            )}
            {group.carbonMeetupBonusAwarded && (
              <p className="text-xs text-goout-green mt-2 font-medium">Bonus carbon credits applied for walking to a Red Pin meetup.</p>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) =>
          <div key={i} className={m.isSOS ? 'bg-red-50 border border-red-200 rounded-lg p-3' : ''}>
              <p className="text-xs text-slate-500 mb-0.5">{m.userName}</p>
              <p className={m.isSOS ? 'font-semibold text-red-700' : ''}>{m.message}</p>
              
              {/* Attachments */}
              {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.attachments.map((att, idx) => (
                    <div key={idx} className="bg-slate-100 rounded-lg p-2">
                      {att.type === 'image' ? (
                        <a href={att.url} target="_blank" rel="noreferrer" className="inline-block max-w-xs hover:opacity-80">
                          <img src={att.url} alt={att.filename} className="max-w-xs max-h-64 rounded-lg" />
                        </a>
                      ) : att.type === 'video' ? (
                        <video controls className="max-w-xs max-h-64 rounded-lg">
                          <source src={att.url} type={att.mimetype} />
                          Your browser does not support the video tag.
                        </video>
                      ) : att.type === 'audio' ? (
                        <audio controls className="w-full">
                          <source src={att.url} type={att.mimetype} />
                          Your browser does not support the audio tag.
                        </audio>
                      ) : (
                        <a 
                          href={att.url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-blue-600 hover:underline text-sm font-medium"
                        >
                          📎 {att.filename}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {m.sosLocation?.coordinates &&
            <a
              href={`https://www.google.com/maps?q=${m.sosLocation.coordinates[1]},${m.sosLocation.coordinates[0]}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 hover:underline block mt-1">
                  View location on map
                </a>
            }
            </div>
          )}
          <div ref={scrollRef} />
        </div>
        <div className="p-4 border-t flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            disabled={chatExpired || uploading}
            className="hidden"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
          />
          
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={chatExpired || uploading}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
            title="Upload file, image, or video"
          >
            📎
          </button>
          
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={chatExpired ? 'Chat expired' : 'Type a message...'}
            disabled={chatExpired || uploading}
            className="flex-1 px-4 py-2 border border-slate-200 rounded-xl disabled:bg-slate-50"
          />

          <button 
            type="button" 
            onClick={send} 
            disabled={chatExpired || uploading}
            className="px-4 py-2 bg-goout-green text-white rounded-xl font-medium disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Send'}
          </button>
        </div>
      </div>

      {/* Share Location Confirmation Modal */}
      {showLocationConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 goout-animate-in">
            <h2 className="text-xl font-bold text-slate-900 mb-2">Share your location?</h2>
            <p className="text-sm text-slate-600 mb-4">
              This will send your current location in the chat so other members can see where you are.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowLocationConfirm(false)}
                disabled={sharingLocation}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmShareLocation}
                disabled={sharingLocation}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-60"
              >
                {sharingLocation ? 'Sharing...' : 'Yes, share'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Group Confirmation Modal */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 goout-animate-in">
            <h2 className="text-xl font-bold text-slate-900 mb-2">Leave this group?</h2>
            <p className="text-sm text-slate-600 mb-4">
              When you leave, you&apos;ll lose access to the chat. This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                disabled={leavingGroup}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={confirmLeaveGroup}
                disabled={leavingGroup}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {leavingGroup ? 'Leaving...' : 'Leave Group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
