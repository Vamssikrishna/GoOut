import { useState, useEffect, useRef } from 'react';
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
  const scrollRef = useRef(null);

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
    setSocket(s);
    return () => {
      s.emit('leave-group', groupId);
      s.disconnect();
    };
  }, [groupId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    if (!input.trim() || !socket) return;
    socket.emit('chat-message', { groupId, message: input.trim() });
    setInput('');
  };

  const sendSOS = () => {
    if (!socket) return;
    navigator.geolocation.getCurrentPosition(
      (p) => socket.emit('sos', { groupId, lat: p.coords.latitude, lng: p.coords.longitude }),
      () => socket.emit('sos', { groupId })
    );
  };

  if (!group) return <div className="p-4">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/app/buddies" className="text-goout-green hover:underline text-sm mb-4 inline-block">← Back to Buddies</Link>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col h-[600px]">
        <div className="p-4 border-b flex flex-wrap justify-between items-center gap-2">
          <div>
            <h2 className="font-display font-semibold text-lg">{group.activity}</h2>
            <p className="text-sm text-slate-600">{group.members?.length || 0} members · {new Date(group.scheduledAt).toLocaleString()}</p>
          </div>
          <div className="flex gap-2">
            {group.safeBy && String(group.safeByUserId) === String(user?.id || user?._id) && new Date(group.safeBy) > new Date() && (
              <button onClick={() => api.post(`/buddies/groups/${groupId}/safe`).then(() => setGroup((g) => ({ ...g, safeBy: null })))} className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium text-sm">
                I&apos;m Safe
              </button>
            )}
            <button onClick={sendSOS} className="px-4 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 text-sm">
              🚨 Emergency SOS
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={m.isSOS ? 'bg-red-50 border border-red-200 rounded-lg p-3' : ''}>
              <p className="text-xs text-slate-500 mb-0.5">{m.userName}</p>
              <p className={m.isSOS ? 'font-semibold text-red-700' : ''}>{m.message}</p>
              {m.sosLocation?.coordinates && (
                <a
                  href={`https://www.google.com/maps?q=${m.sosLocation.coordinates[1]},${m.sosLocation.coordinates[0]}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-blue-600 hover:underline"
                >
                  View location on map
                </a>
              )}
            </div>
          ))}
          <div ref={scrollRef} />
        </div>
        <div className="p-4 border-t flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border border-slate-200 rounded-xl"
          />
          <button onClick={send} className="px-4 py-2 bg-goout-green text-white rounded-xl font-medium">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
