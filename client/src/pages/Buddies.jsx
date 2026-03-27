import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Buddies() {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [matches, setMatches] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    activity: '',
    description: '',
    interests: '',
    meetingPlace: '',
    scheduledAt: '',
    maxMembers: 6,
    safeBy: '',
  });

  useEffect(() => {
    api.get('/buddies/groups').then(({ data }) => setGroups(data)).catch(console.error);
  }, []);

  useEffect(() => {
    if (user?.location?.coordinates?.length === 2) {
      api.get('/buddies/match', {
        params: { lng: user.location.coordinates[0], lat: user.location.coordinates[1] },
      }).then(({ data }) => setMatches(data)).catch(console.error);
    } else {
      api.get('/buddies/match', { params: { lng: 77.209, lat: 28.6139 } })
        .then(({ data }) => setMatches(data)).catch(console.error);
    }
  }, [user]);

  const createGroup = async (e) => {
    e.preventDefault();
    try {
      const coords = user?.location?.coordinates || [77.209, 28.6139];
      await api.post('/buddies/groups', {
        ...form,
        interests: form.interests.split(',').map((s) => s.trim()).filter(Boolean),
        lat: coords[1],
        lng: coords[0],
        safeBy: form.safeBy ? new Date(form.safeBy).toISOString() : undefined,
      });
      const { data } = await api.get('/buddies/groups');
      setGroups(data);
      setShowCreate(false);
      setForm({ activity: '', description: '', interests: '', meetingPlace: '', scheduledAt: '', maxMembers: 6, safeBy: '' });
    } catch (err) {
      console.error(err);
    }
  };

  const joinGroup = async (id) => {
    try {
      await api.post(`/buddies/groups/${id}/join`);
      const { data } = await api.get('/buddies/groups');
      setGroups(data);
      const { data: m } = await api.get('/buddies/match', { params: { lng: 77.209, lat: 28.6139 } });
      setMatches(m);
    } catch (err) {
      console.error(err);
    }
  };

  const acceptRequest = async (groupId, userId) => {
    try {
      await api.post(`/buddies/groups/${groupId}/accept/${userId}`);
      const { data } = await api.get('/buddies/groups');
      setGroups(data);
      const { data: m } = await api.get('/buddies/match', { params: { lng: 77.209, lat: 28.6139 } });
      setMatches(m);
    } catch (err) {
      console.error(err);
    }
  };

  const rejectRequest = async (groupId, userId) => {
    try {
      await api.post(`/buddies/groups/${groupId}/reject/${userId}`);
      const { data } = await api.get('/buddies/groups');
      setGroups(data);
    } catch (err) {
      console.error(err);
    }
  };

  const leaveGroup = async (groupId) => {
    try {
      await api.post(`/buddies/groups/${groupId}/leave`);
      const { data } = await api.get('/buddies/groups');
      setGroups(data);
      const { data: m } = await api.get('/buddies/match', { params: { lng: 77.209, lat: 28.6139 } });
      setMatches(m);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="font-display font-bold text-2xl text-goout-dark">GoOut Buddies</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium hover:bg-goout-accent transition"
        >
          Create Group
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
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
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Interests (comma-separated)</label>
              <input
                type="text"
                value={form.interests}
                onChange={(e) => setForm((f) => ({ ...f, interests: e.target.value }))}
                placeholder="cafe, reading, walking"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Meeting place</label>
              <input
                type="text"
                value={form.meetingPlace}
                onChange={(e) => setForm((f) => ({ ...f, meetingPlace: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">When</label>
              <input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max members</label>
              <input
                type="number"
                value={form.maxMembers}
                onChange={(e) => setForm((f) => ({ ...f, maxMembers: Number(e.target.value) || 6 }))}
                min={2}
                max={12}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Safe by (Dead Man&apos;s Switch)</label>
              <input
                type="datetime-local"
                value={form.safeBy}
                onChange={(e) => setForm((f) => ({ ...f, safeBy: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg"
              />
              <p className="text-xs text-slate-500 mt-1">If you don&apos;t tap &quot;I&apos;m Safe&quot; by this time, emergency contact is notified.</p>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium">
                Create
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border border-slate-200 rounded-lg">
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
            {groups.length === 0 ? (
              <p className="text-slate-500 text-sm">You haven't joined any groups yet.</p>
            ) : (
              groups.map((g) => (
                <div key={g._id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="font-medium">{g.activity}</p>
                  <p className="text-sm text-slate-600">{new Date(g.scheduledAt).toLocaleString()}</p>
                  <p className="text-xs text-slate-500">{g.members?.length || 0}/{g.maxMembers} members</p>
                  <Link to={`/app/group/${g._id}`} className="mt-2 inline-block text-goout-green font-medium text-sm hover:underline">
                    Open Chat →
                  </Link>
                  <div className="mt-2">
                    <button
                      onClick={() => leaveGroup(g._id)}
                      className="px-3 py-1 text-sm rounded-lg border border-slate-200 hover:bg-slate-50"
                    >
                      Leave
                    </button>
                  </div>
                  {String(g.creatorId?._id) === String(user?.id || user?._id) && (g.pendingRequests?.length || 0) > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-slate-700">Pending requests</p>
                      {g.pendingRequests.map((p) => (
                        <div key={p._id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                          <span className="text-sm text-slate-700">{p.name || 'User'}</span>
                          <div className="flex gap-1.5">
                            <button onClick={() => acceptRequest(g._id, p._id)} className="px-2 py-1 text-xs rounded bg-goout-green text-white">
                              Accept
                            </button>
                            <button onClick={() => rejectRequest(g._id, p._id)} className="px-2 py-1 text-xs rounded bg-red-100 text-red-700">
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <h2 className="font-display font-semibold text-lg mb-4">Find Buddies</h2>
          <div className="space-y-3">
            {matches.length === 0 ? (
              <p className="text-slate-500 text-sm">No open groups nearby. Create one!</p>
            ) : (
              matches.map((g) => (
                <div key={g._id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="font-medium">{g.activity}</p>
                  <p className="text-sm text-slate-600">{g.description}</p>
                  <p className="text-xs text-slate-500">{new Date(g.scheduledAt).toLocaleString()} · {g.members?.length || 0}/{g.maxMembers}</p>
                  {g.creatorId?.verified && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">✓ Verified</span>}
                  {!g.members?.some((m) => String(m?._id) === String(user?.id || user?._id)) && g.status === 'open' && (
                    <button
                      onClick={() => joinGroup(g._id)}
                      className="mt-2 px-3 py-1 bg-goout-green text-white text-sm rounded-lg"
                    >
                      Request to Join
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
