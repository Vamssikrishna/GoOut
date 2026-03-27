import jwt from 'jsonwebtoken';
import ChatMessage from '../models/ChatMessage.js';
import User from '../models/User.js';

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
    socket.on('join-group', (groupId) => {
      socket.join(`group-${groupId}`);
    });

    socket.on('leave-group', (groupId) => {
      socket.leave(`group-${groupId}`);
    });

    socket.on('chat-message', async ({ groupId, message }) => {
      try {
        const user = await User.findById(socket.userId).select('name avatar');
        if (!user) return;
        const msg = await ChatMessage.create({
          groupId,
          userId: socket.userId,
          userName: user.name,
          message
        });
        io.to(`group-${groupId}`).emit('new-message', {
          ...msg.toObject(),
          userId: { _id: socket.userId, name: user.name, avatar: user.avatar }
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('sos', async ({ groupId, lat, lng }) => {
      try {
        const user = await User.findById(socket.userId).select('name');
        if (!user) return;
        const msg = await ChatMessage.create({
          groupId,
          userId: socket.userId,
          userName: user.name,
          message: '🚨 EMERGENCY SOS - Location shared',
          isSOS: true,
          sosLocation: lat != null && lng != null ? { type: 'Point', coordinates: [lng, lat] } : undefined
        });
        io.to(`group-${groupId}`).emit('sos', { message: msg, userId: socket.userId });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('crowd-update', ({ businessId, level }) => {
      io.emit('crowd-changed', { businessId, level });
    });
  });
}
