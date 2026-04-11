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
  const scrollRef = useRef(null);

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

  const sendSOS = () => {
    if (!socket || chatExpired) return;
    setSockMsg('');
    navigator.geolocation.getCurrentPosition(
      (p) => socket.emit('sos', { groupId, lat: p.coords.latitude, lng: p.coords.longitude }),
      () => socket.emit('sos', { groupId })
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

  if (!group) return <div className="p-4">Loading...</div>;

  const venue = group.safeVenue;
  const mapsMeetUrl = venue?.lat && venue?.lng
    ? `https://www.google.com/maps?q=${venue.lat},${venue.lng}`
    : null;

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/app/buddies" className="text-goout-green hover:underline text-sm mb-4 inline-block">← Back to Buddies</Link>

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
              {m.sosLocation?.coordinates &&
            <a
              href={`https://www.google.com/maps?q=${m.sosLocation.coordinates[1]},${m.sosLocation.coordinates[0]}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 hover:underline">
                  View location on map
                </a>
            }
            </div>
          )}
          <div ref={scrollRef} />
        </div>
        <div className="p-4 border-t flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={chatExpired ? 'Chat expired' : 'Type a message...'}
            disabled={chatExpired}
            className="flex-1 px-4 py-2 border border-slate-200 rounded-xl disabled:bg-slate-50" />

          <button type="button" onClick={send} disabled={chatExpired} className="px-4 py-2 bg-goout-green text-white rounded-xl font-medium disabled:opacity-50">
            Send
          </button>
        </div>
      </div>
    </div>);

}
