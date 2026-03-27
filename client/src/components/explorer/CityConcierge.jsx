import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../../api/client';

const STORAGE_KEY = 'goout_concierge_messages';

const DEFAULT_MESSAGES = [
  {
    role: 'assistant',
    content:
      "Hi! I'm your GoOut City Concierge. Ask me about nearby places, activities, or how to save money by going out instead of ordering delivery.",
  },
];

function loadStoredMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MESSAGES;
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    ) {
      return parsed;
    }
  } catch {
    // ignore corrupt storage
  }
  return DEFAULT_MESSAGES;
}

export default function CityConcierge({ userLocation, onMapCommands }) {
  const [messages, setMessages] = useState(loadStoredMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // quota / private mode
    }
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const clearChat = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setMessages([...DEFAULT_MESSAGES]);
  }, []);

  const send = async () => {
    if (!input.trim() || loading) return;
    if (!userLocation?.lat || !userLocation?.lng) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: userMsg }]);
    setLoading(true);
    try {
      const { data } = await api.post('/ai/chat', {
        message: userMsg,
        context: { lng: userLocation.lng, lat: userLocation.lat },
      });
      setMessages((m) => [...m, { role: 'assistant', content: data.message || data.reply }]);
      if (Array.isArray(data.mapCommands) && data.mapCommands.length > 0 && typeof onMapCommands === 'function') {
        onMapCommands(data.mapCommands);
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            'Sorry, the AI service is not configured. Set GEMINI_API_KEY in the server .env to enable the City Concierge.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col h-[450px]">
      <div className="p-4 border-b bg-goout-mint flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold text-lg">🤖 City Concierge (Gemini AI)</h2>
          <p className="text-sm text-slate-600">Ask about nearby places, activities, and savings.</p>
          <p className="text-xs text-slate-500 mt-1">Chat is kept until you use Clear chat.</p>
        </div>
        <button
          type="button"
          onClick={clearChat}
          disabled={loading}
          className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Clear chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-4 py-2 rounded-2xl ${
                m.role === 'user' ? 'bg-goout-green text-white' : 'bg-slate-100 text-slate-800'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="px-4 py-2 rounded-2xl bg-slate-100">Thinking...</div>
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
          placeholder="Ask about places, activities..."
          className="flex-1 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-goout-green focus:border-transparent"
        />
        <button
          onClick={send}
          disabled={loading || !userLocation}
          className="px-4 py-2 bg-goout-green text-white rounded-xl font-medium hover:bg-goout-accent disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
