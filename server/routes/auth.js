import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import {
  sendPasswordResetEmail,
  sendLoginOtpEmail,
  sendPasswordChangedEmail,
  isEmailConfigured } from
'../utils/email.js';

const router = express.Router();
const LOGIN_OTP_WINDOW_MS = 30 * 1000;

const generateToken = (user) =>
jwt.sign(
  { id: user._id, role: user.role, merchant: user.role === 'merchant' },
  process.env.JWT_SECRET || 'secret',
  { expiresIn: '30d' }
);

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

const otpPepper = () => process.env.OTP_PEPPER || process.env.JWT_SECRET || 'secret';

const hashLoginOtp = (email, otp) =>
crypto.
createHash('sha256').
update(`${email.toLowerCase().trim()}:${otp}:${otpPepper()}`).
digest('hex');

const safeEqualHex = (a, b) => {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
};

const userPublicFields = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  verified: user.verified,
  businessId: user.businessId || null
});

function normalizeTags(input, max = 24, maxLen = 120) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((s) => String(s || '').trim().slice(0, maxLen)).filter(Boolean))].slice(0, max);
}

function normalizeDiscoveryPreferencesBody(body) {
  return {
    prefer: normalizeTags(body?.prefer, 24, 120),
    avoid: normalizeTags(body?.avoid, 24, 120),
    notes: String(body?.notes || '').slice(0, 800)
  };
}

router.post('/register', [
body('name').trim().notEmpty(),
body('email').isEmail(),
body('password').isLength({ min: 6 })],
async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, email, password, role } = req.body;
    const nextRole = role || 'explorer';
    const interests = normalizeTags(req.body?.interests, 32, 80);
    const discoveryPreferences = normalizeDiscoveryPreferencesBody(req.body || {});
    if (nextRole === 'explorer' && discoveryPreferences.prefer.length === 0) {
      return res.status(400).json({ error: 'Explorer preferences are required during registration.' });
    }
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    const user = await User.create({
      name,
      email,
      password,
      role: nextRole,
      ...(nextRole === 'explorer' ? { interests, discoveryPreferences } : {})
    });
    res.status(201).json({
      user: userPublicFields(user),
      requiresSignIn: true,
      message: 'Account created. Sign in to continue.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', [
body('email').isEmail(),
body('password').notEmpty()],
async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Please enter a valid email and password',
        details: errors.array()
      });
    }
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'This email is not registered. Please check or create an account.' });
    }
    const passwordOk = await user.matchPassword(password);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    const otp = String(crypto.randomInt(100000, 999999));
    user.loginOtpHash = hashLoginOtp(email, otp);
    user.loginOtpExpires = new Date(Date.now() + LOGIN_OTP_WINDOW_MS);
    await user.save();

    if (!isEmailConfigured()) {
      console.warn('[auth] Login OTP (configure SMTP to send email):', otp, 'for', email);
    }
    res.json({
      requiresOtp: true,
      email: user.email,
      message: 'We sent a sign-in code to your email. It expires in 30 seconds.'
    });
    sendLoginOtpEmail(user.email, otp).catch((e) => {
      console.warn('[auth] Failed to send login OTP email:', e?.message || e);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify-login-otp', [
body('email').isEmail(),
body('otp').trim().isLength({ min: 6, max: 6 })],
async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
    }
    const { email, otp } = req.body;
    const user = await User.findOne({ email }).select('+loginOtpHash +loginOtpExpires');
    if (!user?.loginOtpHash || !user?.loginOtpExpires) {
      return res.status(400).json({ error: 'No pending sign-in. Please sign in with your password again.' });
    }
    if (user.loginOtpExpires.getTime() < Date.now()) {
      return res.status(400).json({ error: 'That code expired. Sign in again to get a new one.' });
    }
    const inputHash = hashLoginOtp(email, otp.trim());
    if (!safeEqualHex(inputHash, user.loginOtpHash)) {
      return res.status(400).json({ error: 'Invalid code. Try again.' });
    }
    await User.findByIdAndUpdate(user._id, { $unset: { loginOtpHash: 1, loginOtpExpires: 1 } });

    res.json({
      user: userPublicFields(user),
      token: generateToken(user)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/forgot-password', [body('email').isEmail()], async (req, res) => {
  const generic = { message: 'If that email is registered, we sent reset instructions.' };
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Enter a valid email address.' });
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.json(generic);
    }
    const raw = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = hashToken(raw);
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const clientBase = process.env.CLIENT_URL || 'http://localhost:5173';
    const link = `${clientBase}/reset-password?token=${encodeURIComponent(raw)}`;
    if (!isEmailConfigured()) {
      console.warn('[auth] Password reset link (configure SMTP to send email):', link);
    }
    await sendPasswordResetEmail(user.email, raw);
    return res.json(generic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', [
body('token').notEmpty(),
body('password').isLength({ min: 6 })],
async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Use a token and a password of at least 6 characters.' });
    }
    const { token, password } = req.body;
    const hashed = hashToken(token);
    const user = await User.findOne({
      passwordResetToken: hashed,
      passwordResetExpires: { $gt: new Date() }
    }).select('+passwordResetToken +passwordResetExpires');
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Request a new one.' });
    }
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    sendPasswordChangedEmail(user.email).catch((e) => {
      console.warn('[auth] Failed to send password-changed email:', e?.message || e);
    });
    res.json({ message: 'Password updated. You can sign in now.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).
    select('-password').
    populate('businessId', 'name category address');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;