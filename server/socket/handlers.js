import jwt from 'jsonwebtoken';
import ChatMessage from '../models/ChatMessage.js';
import User from '../models/User.js';
import BuddyGroup from '../models/BuddyGroup.js';
import { sendEmergencySosEmail } from '../utils/email.js';

function groupMemberIds(group) {
  const ids = new Set();
  if (group?.creatorId) ids.add(String(group.creatorId));
  (group?.members || []).forEach((m) => ids.add(String(m)));
  return [...ids];
}

function callRoomUrl(groupId, callType) {
  return `https://meet.jit.si/goout-${String(groupId)}-${String(callType || 'voice')}`;
}

export function setupSocketHandlers(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      socket.userId = decoded.id;
      next();
    } catch (e) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user-${socket.userId}`);

    socket.on('join-group', (groupId) => {
      socket.join(`group-${groupId}`);
    });

    socket.on('leave-group', (groupId) => {
      socket.leave(`group-${groupId}`);
    });

    socket.on('chat-message', async ({ groupId, message, hasLocation, lat, lng }) => {
      try {
        const group = await BuddyGroup.findById(groupId).select('members creatorId chatExpiresAt activity');
        if (!group) return socket.emit('chat-error', { message: 'Group not found' });
        const uid = String(socket.userId);
        const isMember = group.creatorId.toString() === uid ||
        group.members.some((m) => m.toString() === uid);
        if (!isMember) return socket.emit('chat-error', { message: 'Not a member of this buddy chat' });
        if (group.chatExpiresAt && new Date(group.chatExpiresAt) < new Date()) {
          return socket.emit('chat-error', { message: 'This buddy chat has expired (2 hours after meetup time).' });
        }
        const user = await User.findById(socket.userId).select('name avatar');
        if (!user) return;
        const parsedLat = Number(lat);
        const parsedLng = Number(lng);
        const validSharedLocation = Boolean(hasLocation) && Number.isFinite(parsedLat) && Number.isFinite(parsedLng);
        const msg = await ChatMessage.create({
          groupId,
          userId: socket.userId,
          userName: user.name,
          message,
          sharedLocation: validSharedLocation ? { type: 'Point', coordinates: [parsedLng, parsedLat] } : undefined
        });
        io.to(`group-${groupId}`).emit('new-message', {
          ...msg.toObject(),
          userId: { _id: socket.userId, name: user.name, avatar: user.avatar }
        });
      } catch (err) {
        socket.emit('chat-error', { message: err.message });
      }
    });

    socket.on('sos', async ({ groupId, lat, lng }) => {
      try {
        const group = await BuddyGroup.findById(groupId).select('members creatorId chatExpiresAt');
        if (!group) return socket.emit('chat-error', { message: 'Group not found' });
        const uid = String(socket.userId);
        const isMember = group.creatorId.toString() === uid ||
        group.members.some((m) => m.toString() === uid);
        if (!isMember) return socket.emit('chat-error', { message: 'Not a member' });
        if (group.chatExpiresAt && new Date(group.chatExpiresAt) < new Date()) {
          return socket.emit('chat-error', { message: 'This buddy chat has expired.' });
        }
        const user = await User.findById(socket.userId).select('name emergencyEmails');
        if (!user) return;
        const emergencyEmails = Array.isArray(user.emergencyEmails) ?
          [...new Set(user.emergencyEmails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))].slice(0, 3) :
          [];
        if (emergencyEmails.length < 1) {
          return socket.emit('chat-error', { message: 'Add at least one emergency family email in Profile before using SOS.' });
        }
        const msg = await ChatMessage.create({
          groupId,
          userId: socket.userId,
          userName: user.name,
          message: '🚨 EMERGENCY SOS - Location shared',
          isSOS: true,
          sosLocation: lat != null && lng != null ? { type: 'Point', coordinates: [lng, lat] } : undefined
        });
        const mapsUrl = lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : '';
        try {
          await Promise.all(
            emergencyEmails.map((to) =>
              sendEmergencySosEmail({
                to,
                senderName: user.name,
                groupActivity: group?.activity || 'Buddy meetup',
                lat,
                lng,
                mapsUrl
              })
            )
          );
        } catch (mailErr) {
          console.warn('[socket:sos] emergency email failed:', mailErr?.message || mailErr);
        }
        io.to(`group-${groupId}`).emit('sos', { message: msg, userId: socket.userId });
      } catch (err) {
        socket.emit('chat-error', { message: err.message });
      }
    });

    socket.on('call-request', async ({ groupId, callType }) => {
      try {
        const safeType = callType === 'video' ? 'video' : 'voice';
        const group = await BuddyGroup.findById(groupId).select(
          'creatorId members chatExpiresAt callSettings pendingCallRequest'
        );
        if (!group) return socket.emit('chat-error', { message: 'Group not found' });
        const memberIds = groupMemberIds(group);
        const uid = String(socket.userId);
        if (!memberIds.includes(uid)) return socket.emit('chat-error', { message: 'Not a member' });
        if (group.chatExpiresAt && new Date(group.chatExpiresAt) < new Date()) {
          return socket.emit('chat-error', { message: 'This buddy chat has expired.' });
        }

        const settings = group.callSettings || { voiceApprovedForAll: false, videoApprovedForAll: false };
        const alreadyApproved = safeType === 'video' ? settings.videoApprovedForAll : settings.voiceApprovedForAll;
        if (alreadyApproved) {
          return io.to(`group-${groupId}`).emit('call-consent-approved', {
            callType: safeType,
            roomUrl: callRoomUrl(groupId, safeType),
            approvedForAll: true
          });
        }

        if (group.pendingCallRequest?.callType) {
          return socket.emit('chat-error', { message: 'A call approval request is already in progress.' });
        }

        group.pendingCallRequest = {
          callType: safeType,
          requestedBy: socket.userId,
          createdAt: new Date(),
          votes: [{ userId: socket.userId, response: 'yes', at: new Date() }]
        };
        await group.save();

        io.to(`group-${groupId}`).emit('call-consent-requested', {
          callType: safeType,
          requestedBy: uid,
          votes: group.pendingCallRequest.votes.map((v) => ({ userId: String(v.userId), response: v.response })),
          pendingUserIds: memberIds.filter((id) => id !== uid)
        });
      } catch (err) {
        socket.emit('chat-error', { message: err.message });
      }
    });

    socket.on('call-vote', async ({ groupId, response }) => {
      try {
        const vote = response === 'no' ? 'no' : 'yes';
        const group = await BuddyGroup.findById(groupId).select(
          'creatorId members chatExpiresAt callSettings pendingCallRequest'
        );
        if (!group) return socket.emit('chat-error', { message: 'Group not found' });
        const memberIds = groupMemberIds(group);
        const uid = String(socket.userId);
        if (!memberIds.includes(uid)) return socket.emit('chat-error', { message: 'Not a member' });
        const pending = group.pendingCallRequest;
        if (!pending?.callType) return socket.emit('chat-error', { message: 'No pending call approval request.' });

        const votes = Array.isArray(pending.votes) ? pending.votes : [];
        const existingIdx = votes.findIndex((v) => String(v.userId) === uid);
        if (existingIdx >= 0) votes[existingIdx] = { userId: socket.userId, response: vote, at: new Date() };
        else votes.push({ userId: socket.userId, response: vote, at: new Date() });
        pending.votes = votes;

        const anyNo = votes.some((v) => v.response === 'no');
        if (anyNo) {
          const rejectedBy = votes.find((v) => v.response === 'no');
          group.pendingCallRequest = undefined;
          await group.save();
          return io.to(`group-${groupId}`).emit('call-consent-rejected', {
            callType: pending.callType,
            rejectedBy: String(rejectedBy?.userId || uid)
          });
        }

        const yesVoters = new Set(votes.filter((v) => v.response === 'yes').map((v) => String(v.userId)));
        const allAccepted = memberIds.every((id) => yesVoters.has(id));
        if (allAccepted) {
          if (!group.callSettings) group.callSettings = { voiceApprovedForAll: false, videoApprovedForAll: false };
          if (pending.callType === 'video') group.callSettings.videoApprovedForAll = true;
          if (pending.callType === 'voice') group.callSettings.voiceApprovedForAll = true;
          group.pendingCallRequest = undefined;
          await group.save();
          return io.to(`group-${groupId}`).emit('call-consent-approved', {
            callType: pending.callType,
            roomUrl: callRoomUrl(groupId, pending.callType),
            approvedForAll: true
          });
        }

        await group.save();
        return io.to(`group-${groupId}`).emit('call-consent-updated', {
          callType: pending.callType,
          votes: votes.map((v) => ({ userId: String(v.userId), response: v.response })),
          pendingUserIds: memberIds.filter((id) => !yesVoters.has(id))
        });
      } catch (err) {
        socket.emit('chat-error', { message: err.message });
      }
    });

    socket.on('crowd-update', ({ businessId, level }) => {
      io.emit('crowd-changed', { businessId, level });
    });
  });
}