import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import api, { getAssetUrl } from '../api/client';
import { useAuth } from '../context/AuthContext';

const SOCKET_URL = String(
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:5000' : window.location.origin)
).trim();

export default function GroupChat() {
  const PIN_TTL_MS = 24 * 60 * 60 * 1000;
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
  const [showSharedLocationEditor, setShowSharedLocationEditor] = useState(false);
  const [sharedLocationSaving, setSharedLocationSaving] = useState(false);
  const [sharedLocationDraft, setSharedLocationDraft] = useState({
    name: '',
    address: '',
    lat: '',
    lng: ''
  });
  const [sharingLocation, setSharingLocation] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [activeVoiceUrl, setActiveVoiceUrl] = useState('');
  const [callRequest, setCallRequest] = useState(null);
  const [callRoom, setCallRoom] = useState(null);
  const [pendingVote, setPendingVote] = useState(false);
  const [messageActionId, setMessageActionId] = useState('');
  const [showChatActionMenu, setShowChatActionMenu] = useState(false);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const voicePlaybackRef = useRef(null);

  const chatExpired = useMemo(() => {
    if (!group?.chatExpiresAt) return false;
    return new Date(group.chatExpiresAt) < new Date();
  }, [group?.chatExpiresAt]);

  const showPostMeetup = useMemo(() => {
    if (!group?.scheduledAt) return false;
    return new Date() >= new Date(group.scheduledAt);
  }, [group?.scheduledAt]);

  const myId = String(user?.id || user?._id || '');
  const myAvatar = String(user?.avatar || '').trim();
  const isAdmin = String(group?.creatorId?._id || group?.creatorId || '') === myId;
  const sharedLocation = group?.sharedLocation;
  const hasSharedLocation = Number.isFinite(Number(sharedLocation?.lat)) && Number.isFinite(Number(sharedLocation?.lng));
  const sharedLocationMapsUrl = hasSharedLocation ?
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${sharedLocation.lat},${sharedLocation.lng}`)}` :
    '';
  const pinnedMessages = useMemo(
    () =>
      [...messages]
        .filter((m) => Boolean(m?.pinnedAt) && (Date.now() - new Date(m.pinnedAt).getTime()) < PIN_TTL_MS)
        .sort((a, b) => new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime()),
    [messages]
  );

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
    const s = io(SOCKET_URL, { auth: { token } });
    s.on('connect', () => {
      s.emit('join-group', groupId);
    });
    s.on('new-message', (msg) => setMessages((m) => [...m, msg]));
    s.on('sos-triggered', ({ message }) => setSockMsg(message || 'SOS sent. Emergency contacts were notified.'));
    s.on('message-pinned', ({ message }) =>
      setMessages((prev) => prev.map((m) => (String(m._id) === String(message._id) ? { ...m, ...message } : m)))
    );
    s.on('message-unpinned', ({ messageId }) =>
      setMessages((prev) => prev.map((m) => (String(m._id) === String(messageId) ? { ...m, pinnedAt: null, pinnedBy: null } : m)))
    );
    s.on('message-deleted', ({ messageId }) =>
      setMessages((prev) => prev.filter((m) => String(m._id) !== String(messageId)))
    );
    s.on('group-location-updated', ({ sharedLocation }) =>
      setGroup((g) => g ? { ...g, sharedLocation } : g)
    );
    s.on('call-consent-requested', (payload) => {
      setCallRoom(null);
      setCallRequest(payload);
      setSockMsg('Group meeting request started. Please vote.');
    });
    s.on('call-consent-updated', (payload) => setCallRequest((prev) => ({ ...(prev || {}), ...payload })));
    s.on('call-consent-rejected', () => {
      setCallRequest(null);
      setCallRoom(null);
      setSockMsg('Group meeting was declined by a member.');
    });
    s.on('call-consent-approved', (payload) => {
      setCallRequest(null);
      setCallRoom(payload);
      setGroup((g) =>
        g ?
          {
            ...g,
            callSettings: {
              ...(g.callSettings || {}),
              ...(payload.callType === 'video' ? { videoApprovedForAll: true } : { voiceApprovedForAll: true })
            }
          } :
          g
      );
      setSockMsg('All members accepted. You can join Google Meet now.');
    });
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

  useEffect(() => () => {
    try {
      mediaRecorderRef.current?.stop?.();
    } catch {}
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    }
    mediaStreamRef.current = null;
    if (voicePlaybackRef.current) {
      try {
        voicePlaybackRef.current.pause();
      } catch {}
    }
    voicePlaybackRef.current = null;
  }, []);

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

  const openSharedLocationEditor = () => {
    setSharedLocationDraft({
      name: sharedLocation?.name || '',
      address: sharedLocation?.address || '',
      lat: sharedLocation?.lat != null ? String(sharedLocation.lat) : '',
      lng: sharedLocation?.lng != null ? String(sharedLocation.lng) : ''
    });
    setSockMsg('');
    setShowSharedLocationEditor((v) => !v);
  };

  const useCurrentLocationForSharedPin = () => {
    if (!navigator.geolocation) {
      setSockMsg('Geolocation is not supported in this browser.');
      return;
    }
    setSockMsg('Getting your location for the group pin…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSharedLocationDraft((prev) => ({
          ...prev,
          lat: String(position.coords.latitude.toFixed(6)),
          lng: String(position.coords.longitude.toFixed(6))
        }));
        setSockMsg('Location added to the editor. Review and save it for the group.');
      },
      () => setSockMsg('Could not read your location. You can enter coordinates manually.')
    );
  };

  const saveSharedLocation = async (e) => {
    e.preventDefault();
    if (chatExpired) return;
    const lat = Number(sharedLocationDraft.lat);
    const lng = Number(sharedLocationDraft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setSockMsg('Add valid latitude and longitude before saving the group location.');
      return;
    }
    setSharedLocationSaving(true);
    setSockMsg('');
    try {
      const { data } = await api.put(`/buddies/groups/${groupId}/shared-location`, {
        name: sharedLocationDraft.name,
        address: sharedLocationDraft.address,
        lat,
        lng
      });
      setGroup((g) => g ? { ...g, sharedLocation: data.sharedLocation } : g);
      setShowSharedLocationEditor(false);
      setSockMsg('Group location saved. Everyone in this chat can see it.');
    } catch (err) {
      setSockMsg(err?.response?.data?.error || 'Could not save group location.');
    } finally {
      setSharedLocationSaving(false);
    }
  };

  const startAudioRecording = async () => {
    if (recordingAudio || recordingBusy || chatExpired) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      setSockMsg('Audio recording is not supported in this browser.');
      return;
    }
    setSockMsg('');
    setRecordingBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const preferredMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4'
      ];
      const pickedMimeType = preferredMimeTypes.find((mime) =>
        typeof window.MediaRecorder.isTypeSupported === 'function' && window.MediaRecorder.isTypeSupported(mime)
      );
      const recorder = pickedMimeType ? new window.MediaRecorder(stream, { mimeType: pickedMimeType }) : new window.MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const mime = recorder.mimeType || pickedMimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mime });
        audioChunksRef.current = [];
        const ext =
          mime.includes('ogg') ? 'ogg' :
            mime.includes('mp4') || mime.includes('m4a') ? 'm4a' :
              mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' :
                mime.includes('wav') ? 'wav' :
                  'webm';
        const voiceFile = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mime });
        if (blob.size > 0) {
          await uploadFile(voiceFile);
        } else {
          setSockMsg('No audio captured. Please try again.');
        }
      };

      recorder.start(250);
      setRecordingAudio(true);
    } catch (err) {
      setSockMsg(err?.message || 'Microphone access denied or unavailable.');
    } finally {
      setRecordingBusy(false);
    }
  };

  const stopAudioRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setRecordingAudio(false);
    try {
      recorder.stop();
    } catch {}
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      mediaStreamRef.current = null;
    }
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

  const toggleVoicePlayback = (url) => {
    const nextUrl = String(url || '').trim();
    if (!nextUrl) return;
    const current = voicePlaybackRef.current;
    if (current && activeVoiceUrl === nextUrl) {
      try {
        current.pause();
        current.currentTime = 0;
      } catch {}
      voicePlaybackRef.current = null;
      setActiveVoiceUrl('');
      return;
    }
    if (current) {
      try {
        current.pause();
      } catch {}
    }
    const player = new Audio(nextUrl);
    voicePlaybackRef.current = player;
    setActiveVoiceUrl(nextUrl);
    player.onended = () => {
      if (voicePlaybackRef.current === player) {
        voicePlaybackRef.current = null;
        setActiveVoiceUrl('');
      }
    };
    player.onerror = () => {
      if (voicePlaybackRef.current === player) {
        voicePlaybackRef.current = null;
        setActiveVoiceUrl('');
      }
      setSockMsg('Could not play this voice message.');
    };
    player.play().catch(() => {
      if (voicePlaybackRef.current === player) {
        voicePlaybackRef.current = null;
        setActiveVoiceUrl('');
      }
      setSockMsg('Could not play this voice message.');
    });
  };

  const requestCall = (callType) => {
    if (!socket || chatExpired) return;
    if (!isAdmin) {
      setSockMsg('Only the group admin can start call requests.');
      return;
    }
    setSockMsg('');
    socket.emit('call-request', { groupId, callType: 'video' });
  };

  const voteOnCall = (response) => {
    if (!socket || !callRequest || pendingVote) return;
    setPendingVote(true);
    socket.emit('call-vote', { groupId, response });
    setTimeout(() => setPendingVote(false), 400);
  };

  const pinMessage = async (messageId) => {
    if (!isAdmin) return;
    try {
      await api.post(`/chat/${groupId}/messages/${messageId}/pin`);
    } catch (err) {
      setSockMsg(err?.response?.data?.error || 'Could not pin message.');
    }
  };

  const unpinMessage = async (messageId) => {
    if (!isAdmin) return;
    try {
      await api.post(`/chat/${groupId}/messages/${messageId}/unpin`);
    } catch (err) {
      setSockMsg(err?.response?.data?.error || 'Could not unpin message.');
    }
  };

  const deleteMessage = async (messageId) => {
    try {
      await api.delete(`/chat/${groupId}/messages/${messageId}`);
      setMessageActionId('');
    } catch (err) {
      setSockMsg(err?.response?.data?.error || 'Could not delete message.');
    }
  };

  const deleteMessageForMe = async (messageId) => {
    try {
      await api.post(`/chat/${groupId}/messages/${messageId}/delete-for-me`);
      setMessages((prev) => prev.filter((m) => String(m._id) !== String(messageId)));
      setMessageActionId('');
    } catch (err) {
      setSockMsg(err?.response?.data?.error || 'Could not delete message for you.');
    }
  };

  const confirmShareLocation = () => {
    setSharingLocation(true);
    setSockMsg('');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const goOutLink = `${window.location.origin}/app/explorer?focusLat=${encodeURIComponent(p.coords.latitude)}&focusLng=${encodeURIComponent(p.coords.longitude)}`;
        socket?.emit('chat-message', { 
          groupId, 
          message: `📍 My GoOut location: ${goOutLink}`,
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

  const toInitials = (fullName) => {
    const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return `${words[0]?.[0] || ''}${words[1]?.[0] || ''}`.toUpperCase() || '?';
  };

  const renderMessageContent = (text) => {
    const messageText = String(text || '');
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const isUrl = (value) => /^https?:\/\/[^\s]+$/.test(value);
    const parts = messageText.split(urlRegex);
    return parts.map((part, idx) => {
      if (!part) return null;
      if (isUrl(part)) {
        return (
          <a
            key={`${part}-${idx}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline break-all"
          >
            {part}
          </a>
        );
      }
      return <span key={`txt-${idx}`}>{part}</span>;
    });
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
  const isPairHangout = group?.inviteType === 'pair' || Number(group?.maxMembers) === 2;

  return (
    <div className="w-full space-y-4 goout-animate-in">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <Link
        to="/app/buddies"
        className="goout-btn-ghost text-sm py-2 px-3 inline-flex border-slate-200 hover:border-emerald-300/50">
        ← Back to Buddies
      </Link>
      </div>

      {!isPairHangout && venue?.name && (
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

      {pinnedMessages.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-1">Pinned message</p>
          <p className="text-sm text-slate-800">{pinnedMessages[0].message}</p>
          <p className="text-[11px] text-slate-500 mt-1">By {pinnedMessages[0].userName}</p>
        </div>
      )}

      <div className="goout-chat-shell bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col min-h-[360px] sm:h-[640px] sm:min-h-[540px]">
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
          <div className="goout-chat-actions-wrap">
            <button
              type="button"
              onClick={() => setShowChatActionMenu((v) => !v)}
              aria-label="Open chat actions"
              title="Chat actions"
              className="goout-chat-dots-btn"
            >
              ...
            </button>
            <div className={`goout-chat-action-menu ${showChatActionMenu ? 'goout-chat-action-menu--open' : ''}`}>
              <button
                type="button"
                onClick={() => {
                  setShowChatActionMenu(false);
                  requestCall();
                }}
                disabled={chatExpired}
                aria-label="Start group meeting"
                title="Start group meeting"
                className="goout-chat-action-orb goout-chat-action-orb--meet"
              >
                🎥
              </button>
              {group.safeBy && String(group.safeByUserId) === String(user?.id || user?._id) && new Date(group.safeBy) > new Date() &&
              <button
                type="button"
                onClick={() => {
                  setShowChatActionMenu(false);
                  api.post(`/buddies/groups/${groupId}/safe`).then(() => setGroup((g) => ({ ...g, safeBy: null })));
                }}
                aria-label="I am safe"
                title="I'm Safe"
                className="goout-chat-action-orb goout-chat-action-orb--safe"
              >
                  ✅
                </button>
              }
              <button
                type="button"
                onClick={() => {
                  setShowChatActionMenu(false);
                  sendSOS();
                }}
                disabled={chatExpired}
                aria-label="SOS need help"
                title="SOS - need help"
                className="goout-chat-action-orb goout-chat-action-orb--sos"
              >
                🚨
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowChatActionMenu(false);
                  setShowLocationConfirm(true);
                }}
                disabled={chatExpired}
                aria-label="Share location"
                title="Share location"
                className="goout-chat-action-orb goout-chat-action-orb--location"
              >
                📍
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowChatActionMenu(false);
                  openSharedLocationEditor();
                }}
                disabled={chatExpired}
                aria-label={hasSharedLocation ? 'Change group map pin' : 'Set group map pin'}
                title={hasSharedLocation ? 'Change group map pin' : 'Set group map pin'}
                className="goout-chat-action-orb goout-chat-action-orb--map"
              >
                🗺
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setShowChatActionMenu(false);
                  setShowLeaveConfirm(true);
                }}
                aria-label="Leave group"
                title="Leave group"
                className="goout-chat-action-orb goout-chat-action-orb--leave"
              >
                🚪
              </button>
            </div>
          </div>
        </div>

        {callRequest && (
          <div className="px-4 py-3 border-b bg-indigo-50 text-sm">
            <p className="font-medium text-indigo-900">Group meeting request from group admin</p>
            <p className="text-indigo-700 mt-1">Join only if you are comfortable. All members must accept.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => voteOnCall('yes')}
                disabled={pendingVote}
                className="px-3 py-1.5 rounded-lg bg-goout-green text-white text-xs font-medium disabled:opacity-60"
              >
                Yes, I&apos;m comfortable
              </button>
              <button
                type="button"
                onClick={() => voteOnCall('no')}
                disabled={pendingVote}
                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium disabled:opacity-60"
              >
                No
              </button>
            </div>
          </div>
        )}

        {callRoom?.roomUrl && (
          <div className="px-4 py-3 border-b bg-emerald-50 text-sm">
            <p className="font-medium text-emerald-900">Group meeting approved by everyone.</p>
            <a href={callRoom.roomUrl} target="_blank" rel="noreferrer" className="inline-block mt-1 text-emerald-800 underline font-medium">
              Join Google Meet
            </a>
          </div>
        )}

        {(hasSharedLocation || showSharedLocationEditor) && (
          <div className="border-b bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-4 py-3 text-sm">
            {hasSharedLocation && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Shared group map pin</p>
                  <p className="mt-1 font-semibold text-slate-900">{sharedLocation.name || 'Group location'}</p>
                  {sharedLocation.address && <p className="mt-0.5 text-xs text-slate-600">{sharedLocation.address}</p>}
                  <p className="mt-1 text-[11px] text-slate-500">
                    {Number(sharedLocation.lat).toFixed(5)}, {Number(sharedLocation.lng).toFixed(5)}
                    {sharedLocation.updatedBy?.name ? ` · updated by ${sharedLocation.updatedBy.name}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={sharedLocationMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-50"
                  >
                    Open map
                  </a>
                  <button
                    type="button"
                    onClick={openSharedLocationEditor}
                    disabled={chatExpired}
                    className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Change pin
                  </button>
                </div>
              </div>
            )}

            {showSharedLocationEditor && (
              <form onSubmit={saveSharedLocation} className="mt-3 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Location name</span>
                    <input
                      className="goout-input mt-1"
                      value={sharedLocationDraft.name}
                      onChange={(e) => setSharedLocationDraft((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Cafe, gate, public plaza..."
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Address or note</span>
                    <input
                      className="goout-input mt-1"
                      value={sharedLocationDraft.address}
                      onChange={(e) => setSharedLocationDraft((prev) => ({ ...prev, address: e.target.value }))}
                      placeholder="Near the main entrance..."
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Latitude</span>
                    <input
                      className="goout-input mt-1"
                      value={sharedLocationDraft.lat}
                      onChange={(e) => setSharedLocationDraft((prev) => ({ ...prev, lat: e.target.value }))}
                      placeholder="17.385044"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Longitude</span>
                    <input
                      className="goout-input mt-1"
                      value={sharedLocationDraft.lng}
                      onChange={(e) => setSharedLocationDraft((prev) => ({ ...prev, lng: e.target.value }))}
                      placeholder="78.486671"
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={useCurrentLocationForSharedPin} className="goout-btn-ghost text-xs px-3 py-2">
                    Use my current location
                  </button>
                  <button type="submit" disabled={sharedLocationSaving || chatExpired} className="goout-btn-primary text-xs px-3 py-2">
                    {sharedLocationSaving ? 'Saving…' : 'Save group pin'}
                  </button>
                </div>
                <p className="mt-2 text-[11px] font-medium text-slate-500">Anyone in this group can change this saved pin.</p>
              </form>
            )}
          </div>
        )}

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
          {messages.map((m, i) => {
            const isMine = String(m.userId?._id || m.userId) === myId;
            const senderName = String(m.userId?.name || m.userName || 'Member');
            const senderAvatar = getAssetUrl(String(
              (isMine ? myAvatar : '') ||
              m.userId?.avatar ||
              ''
            ).trim());
            return (
          <div
            key={i}
            onDoubleClick={() => !m.isSOS && setMessageActionId((prev) => (prev === String(m._id) ? '' : String(m._id)))}
            className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
          >
              <div className={`flex items-end gap-2 max-w-[88%] ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                {senderAvatar ? (
                  <img
                    src={senderAvatar}
                    alt={senderName}
                    title={senderName}
                    className="h-8 w-8 rounded-full object-cover border border-slate-200 shrink-0"
                  />
                ) : (
                  <div
                    title={senderName}
                    className={`h-8 w-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold text-white ${
                      isMine ? 'bg-emerald-500' : 'bg-slate-500'
                    }`}
                  >
                    {toInitials(senderName)}
                  </div>
                )}
                <div className={`max-w-full ${m.isSOS ? 'bg-red-50 border border-red-200' : isMine ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'} rounded-lg p-3 hover:bg-opacity-90 cursor-pointer`}>
                  <p className={m.isSOS ? 'font-semibold text-red-700' : 'text-slate-800'}>
                    {renderMessageContent(m.message)}
                  </p>
              
              {/* Attachments */}
              {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.attachments.map((att, idx) => {
                    const attachmentUrl = getAssetUrl(att.url);
                    return (
                    <div
                      key={idx}
                      className={att.type === 'audio' ? '' : 'bg-slate-100 rounded-lg p-2'}
                    >
                      {att.type === 'image' ? (
                        <a href={attachmentUrl} target="_blank" rel="noreferrer" className="inline-block max-w-xs hover:opacity-80">
                          <img src={attachmentUrl} alt={att.filename} className="max-w-xs max-h-64 rounded-lg" />
                        </a>
                      ) : att.type === 'video' ? (
                        <video controls className="max-w-xs max-h-64 rounded-lg">
                          <source src={attachmentUrl} type={att.mimetype} />
                          Your browser does not support the video tag.
                        </video>
                      ) : att.type === 'audio' ? (
                        <div className={`goout-voice-note ${isMine ? 'goout-voice-note--mine' : ''} ${activeVoiceUrl === attachmentUrl ? 'goout-voice-note--playing' : ''}`}>
                          <button
                            type="button"
                            onClick={() => toggleVoicePlayback(attachmentUrl)}
                            aria-label={activeVoiceUrl === attachmentUrl ? 'Stop voice message' : 'Play voice message'}
                            title={activeVoiceUrl === attachmentUrl ? 'Stop voice message' : 'Play voice message'}
                            className="goout-voice-play-btn"
                          >
                            {activeVoiceUrl === attachmentUrl ? '■' : '▶'}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                                Voice note
                              </span>
                              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                {activeVoiceUrl === attachmentUrl ? 'Playing' : 'Tap to play'}
                              </span>
                            </div>
                            <div className="goout-voice-wave" aria-hidden>
                              {Array.from({ length: 18 }).map((_, barIdx) => (
                                <span key={barIdx} style={{ '--bar-height': `${22 + ((barIdx * 13) % 38)}%` }} />
                              ))}
                            </div>
                            <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
                              {att.filename || 'Voice message'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <a 
                          href={attachmentUrl}
                          target="_blank" 
                          rel="noreferrer"
                          className="text-blue-600 hover:underline text-sm font-medium"
                        >
                          📎 {att.filename}
                        </a>
                      )}
                    </div>
                  );
                  })}
                </div>
              )}

            {!m.isSOS && messageActionId === String(m._id) && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {isAdmin && (
                  m.pinnedAt ?
                  <button
                    type="button"
                    onClick={() => unpinMessage(m._id)}
                    className="px-2 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  >
                    Unpin
                  </button> :
                  <button
                    type="button"
                    onClick={() => pinMessage(m._id)}
                    className="px-2 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  >
                    Pin
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteMessageForMe(m._id)}
                  className="px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                >
                  Delete for me
                </button>
                {(isAdmin || String(m.userId?._id || m.userId) === myId) && (
                  <button
                    type="button"
                    onClick={() => deleteMessage(m._id)}
                    className="px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                  >
                    Delete for everyone
                  </button>
                )}
              </div>
            )}
                </div>
              </div>
            </div>
          );})}
          <div ref={scrollRef} />
        </div>
        <div className="p-3 sm:p-4 border-t flex flex-wrap sm:flex-nowrap gap-2">
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
            disabled={chatExpired || uploading || recordingAudio || recordingBusy}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50 border border-transparent hover:border-slate-200"
            title="Upload file, image, or video"
          >
            📎
          </button>

          <button
            type="button"
            onClick={openSharedLocationEditor}
            disabled={chatExpired || uploading || recordingAudio || recordingBusy}
            className={`p-2 rounded-lg disabled:opacity-50 border ${
              hasSharedLocation ?
                'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100' :
                'text-slate-600 hover:bg-slate-100 border-transparent hover:border-slate-200'
            }`}
            title={hasSharedLocation ? 'Change group map pin' : 'Set group map pin'}
            aria-label={hasSharedLocation ? 'Change group map pin' : 'Set group map pin'}
          >
            🗺
          </button>

          <button
            type="button"
            onClick={recordingAudio ? stopAudioRecording : startAudioRecording}
            disabled={chatExpired || uploading || recordingBusy}
            className={`p-2 rounded-lg disabled:opacity-50 border ${
              recordingAudio ? 'bg-red-100 text-red-700 hover:bg-red-200 border-red-200' : 'text-slate-600 hover:bg-slate-100 border-transparent hover:border-slate-200'
            }`}
            title={recordingAudio ? 'Stop recording and send voice note' : 'Record and send voice note'}
          >
            {recordingAudio ? '⏹️' : '🎤'}
          </button>
          
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={chatExpired ? 'Chat expired' : 'Type a message...'}
            disabled={chatExpired || uploading || recordingAudio}
            className="min-w-[180px] flex-1 px-4 py-2 border border-slate-200 rounded-xl disabled:bg-slate-50"
          />

          <button
            type="button" 
            onClick={send} 
            disabled={chatExpired || uploading || recordingAudio}
            className="goout-btn-primary px-4 py-2 rounded-xl font-medium disabled:opacity-50"
          >
            {recordingAudio ? 'Recording...' : uploading ? 'Uploading...' : 'Send'}
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
