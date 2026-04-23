import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import connectDB from './config/db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import businessRoutes from './routes/businesses.js';
import buddyRoutes from './routes/buddies.js';
import offerRoutes from './routes/offers.js';
import chatRoutes from './routes/chat.js';
import visitRoutes from './routes/visits.js';
import geocodeRoutes from './routes/geocode.js';
import budgetRoutes from './routes/budget.js';
import directionsRoutes from './routes/directions.js';
import compareRoutes from './routes/compare.js';
import greenRoutes from './routes/green.js';
import conciergeRoutes from './routes/concierge.js';
import uploadRoutes from './routes/uploads.js';
import { setupSocketHandlers } from './socket/handlers.js';
import Business from './models/Business.js';
import { runBuddyMeetupReminderSweep } from './services/buddyReminderService.js';
connectDB();

function parseAllowedOrigins() {
  const defaults = ['http://localhost:5173'];
  const fromClientUrl = String(process.env.CLIENT_URL || '').split(',');
  const fromMobile = String(process.env.MOBILE_APP_ORIGINS || '').split(',');
  const all = [...defaults, ...fromClientUrl, ...fromMobile]
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

const allowedOrigins = parseAllowedOrigins();
const allowAnyOrigin = allowedOrigins.includes('*');

function corsOriginHandler(origin, callback) {
  if (allowAnyOrigin) return callback(null, true);
  if (!origin) return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  return callback(null, false);
}

const CROWD_DECAY_MS = 3 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    const r = await Business.updateMany(
      { crowdLastPing: { $lt: new Date(Date.now() - CROWD_DECAY_MS) } },
      { $set: { crowdLevel: 50 } }
    );
    if (r.modifiedCount > 0) console.log('[Crowd] Auto-reset', r.modifiedCount, 'stale businesses to Medium');
  } catch (e) {
    console.error('[Crowd] Auto-reset error', e);
  }
}, 15 * 60 * 1000);

let buddyReminderSweepRunning = false;
setInterval(async () => {
  if (buddyReminderSweepRunning) return;
  buddyReminderSweepRunning = true;
  try {
    await runBuddyMeetupReminderSweep(io);
  } catch (e) {
    console.error('[BuddyReminder] sweep error', e);
  } finally {
    buddyReminderSweepRunning = false;
  }
}, 30 * 1000);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOriginHandler,
    credentials: true,
  },
});

app.use(cors({ origin: corsOriginHandler, credentials: true }));
app.use(express.json());
app.use('/uploads', express.static(join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/buddies', buddyRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/geocode', geocodeRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/directions', directionsRoutes);
app.use('/api/compare', compareRoutes);
app.use('/api/green', greenRoutes);
app.use('/api/concierge', conciergeRoutes);
app.use('/api/uploads', uploadRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'GoOut API running' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.set('io', io);
setupSocketHandlers(io);

// Initial sweep shortly after startup so reminders are not missed.
setTimeout(() => {
  runBuddyMeetupReminderSweep(io).catch((e) => console.error('[BuddyReminder] initial sweep error', e));
}, 4000);

function getCliArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const cliPort = Number.parseInt(getCliArgValue('--port') || '', 10);
const cliHost = getCliArgValue('--host');
const requestedPort = Number.isFinite(cliPort) ? cliPort : Number.parseInt(process.env.PORT || '5000', 10);
const requestedHost = cliHost || process.env.HOST || '0.0.0.0';

function startServer(port) {
  httpServer.listen(port, requestedHost, () => {
    console.log(`GoOut server running on http://${requestedHost}:${port}`);
  });
}

httpServer.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`Port ${requestedPort} is already in use. Set a free port via "--port <port>" or PORT in .env.`);
    process.exit(1);
  }
  throw err;
});

startServer(requestedPort);