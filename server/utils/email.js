import nodemailer from 'nodemailer';

const clientUrl = () => process.env.CLIENT_URL || 'http://localhost:5173';

let transporterCache = null;
let transporterCacheKey = '';

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const nextKey = `${host}|${port}|${user}|${pass ? 'x' : ''}`;
  if (transporterCache && transporterCacheKey === nextKey) return transporterCache;
  transporterCache = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    auth: { user, pass }
  });
  transporterCacheKey = nextKey;
  return transporterCache;
}

export function isEmailConfigured() {
  return !!getTransporter();
}

export async function sendMail({ to, subject, text, html, replyTo }) {
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!transporter || !from) {
    console.warn('[email] SMTP not configured; skipped send to', to, subject);
    return { skipped: true };
  }
  const payload = { from, to, subject, text, html };
  const safeReplyTo = String(replyTo || '').trim();
  if (safeReplyTo) payload.replyTo = safeReplyTo;
  await transporter.sendMail(payload);
  return { sent: true };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderEmailTemplate({
  preheader = '',
  badge = 'GoOut',
  title = '',
  subtitle = '',
  bodyHtml = '',
  ctaLabel = '',
  ctaUrl = '',
  accent = '#10b981',
  footerNote = 'You received this email because you use GoOut.'
}) {
  const safePreheader = escapeHtml(preheader);
  const safeBadge = escapeHtml(badge);
  const safeTitle = escapeHtml(title);
  const safeSubtitle = escapeHtml(subtitle);
  const safeFooterNote = escapeHtml(footerNote);
  const ctaHtml =
    ctaLabel && ctaUrl ?
      `<div style="margin-top:20px;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:${escapeHtml(accent)};color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;">
          ${escapeHtml(ctaLabel)}
        </a>
      </div>` :
      '';

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle || 'GoOut'}</title>
</head>
<body style="margin:0;padding:0;background:#f3f8f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f8f7;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#111827,${escapeHtml(accent)});padding:22px 24px;">
              <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.16);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#ecfeff;font-weight:700;">
                ${safeBadge}
              </div>
              <h1 style="margin:12px 0 0 0;color:#ffffff;font-size:24px;line-height:1.25;">${safeTitle}</h1>
              ${safeSubtitle ? `<p style="margin:8px 0 0 0;color:#d1fae5;font-size:14px;line-height:1.45;">${safeSubtitle}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px 14px 24px;font-size:14px;line-height:1.6;color:#1e293b;">
              ${bodyHtml}
              ${ctaHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:10px 24px 22px 24px;border-top:1px solid #e2e8f0;">
              <p style="margin:10px 0 0 0;font-size:12px;color:#64748b;line-height:1.5;">${safeFooterNote}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendPasswordResetEmail(to, rawToken) {
  const link = `${clientUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const subject = 'Reset your GoOut password';
  const text =
    `We received a request to reset your GoOut password.\n\n` +
    `Reset link (valid for 1 hour):\n${link}\n\n` +
    `If this was not you, you can ignore this email.`;
  const html = renderEmailTemplate({
    preheader: 'Password reset link (valid for 1 hour)',
    badge: 'Security',
    title: 'Reset Your Password',
    subtitle: 'Use the secure link below to choose a new password.',
    accent: '#ef4444',
    bodyHtml:
      `<p>We received a request to reset your GoOut password.</p>` +
      `<p>This reset link is valid for <strong>1 hour</strong>.</p>`,
    ctaLabel: 'Reset password',
    ctaUrl: link,
    footerNote: 'If you did not request a reset, no action is required.'
  });
  return sendMail({ to, subject, text, html });
}

export async function sendLoginOtpEmail(to, otp) {
  const subject = 'Your GoOut sign-in code';
  const safeOtp = String(otp || '').trim();
  const text =
    `Your GoOut sign-in code is: ${safeOtp}\n\n` +
    `It expires in 30 seconds.\n` +
    `If this was not you, change your password immediately.`;
  const html = renderEmailTemplate({
    preheader: 'Your secure sign-in code',
    badge: 'OTP Login',
    title: 'Your Sign-In Code',
    subtitle: 'Use this code to continue signing in.',
    accent: '#f97316',
    bodyHtml:
      `<p>Enter this one-time code in GoOut:</p>` +
      `<div style="margin-top:8px;display:inline-block;padding:10px 14px;border-radius:12px;border:1px dashed #f97316;background:#fff7ed;font-size:26px;letter-spacing:0.2em;font-weight:800;color:#9a3412;">${escapeHtml(safeOtp)}</div>` +
      `<p style="margin-top:14px;">Code expires in <strong>30 seconds</strong>.</p>`
  });
  return sendMail({ to, subject, text, html });
}

export async function sendPasswordChangedEmail(to) {
  const subject = 'Your GoOut password was changed';
  const text =
    'Your GoOut password was changed successfully.\n\n' +
    'If this was not you, reset your password immediately from the app.';
  const html = renderEmailTemplate({
    preheader: 'Security alert for your account',
    badge: 'Security Alert',
    title: 'Password Updated',
    subtitle: 'Your account credentials were updated successfully.',
    accent: '#0ea5e9',
    bodyHtml:
      '<p>Your GoOut password has been changed.</p>' +
      '<p>If you did not do this, reset your password immediately and review your account activity.</p>'
  });
  return sendMail({ to, subject, text, html });
}

export async function sendMeetupReminderEmail({
  to,
  activity,
  whenText,
  place,
  label
}) {
  const safeActivity = String(activity || 'Buddy meetup').trim();
  const safeWhenText = String(whenText || 'soon').trim();
  const safePlace = String(place || 'your meetup location').trim();
  const safeLabel = String(label || 'soon').trim();
  const subject = `Reminder: ${safeActivity} starts in ~${safeLabel}`;
  const text =
    `Your meetup starts in about ${safeLabel}.\n\n` +
    `Activity: ${safeActivity}\n` +
    `When: ${safeWhenText}\n` +
    `Venue: ${safePlace}\n\n` +
    'Open GoOut and continue in Buddies chat.';
  const html = renderEmailTemplate({
    preheader: `Meetup reminder · starts in ${safeLabel}`,
    badge: 'Buddy Meetup',
    title: `${safeActivity} starts in ~${safeLabel}`,
    subtitle: 'Friendly reminder to keep your meetup on track.',
    accent: '#22c55e',
    bodyHtml:
      `<p><strong>When:</strong> ${escapeHtml(safeWhenText)}</p>` +
      `<p><strong>Venue:</strong> ${escapeHtml(safePlace)}</p>` +
      '<p>Open GoOut to continue in Buddies chat.</p>'
  });
  return sendMail({ to, subject, text, html });
}

export async function sendMerchantFeedbackEmail({
  to,
  businessName,
  matched,
  note,
  userName,
  userEmail,
  replyTo
}) {
  const safeBusinessName = String(businessName || 'your business').trim();
  const safeUserName = String(userName || 'Explorer').trim();
  const safeUserEmail = String(userEmail || 'unknown').trim();
  const safeNote = String(note || '').trim();
  const isMatched = Boolean(matched);
  const subject = `New GoOut feedback for ${safeBusinessName}`;
  const text =
    `You received new user feedback for ${safeBusinessName}.\n\n` +
    `Matched expectation: ${isMatched ? 'Yes' : 'No'}\n` +
    `Feedback note: ${safeNote || '(no note)'}\n` +
    `User: ${safeUserName} (${safeUserEmail})`;
  const html = renderEmailTemplate({
    preheader: `New feedback for ${safeBusinessName}`,
    badge: 'Merchant Feedback',
    title: 'New Customer Feedback',
    subtitle: `Business: ${safeBusinessName}`,
    accent: '#8b5cf6',
    bodyHtml:
      `<p><strong>Matched expectation:</strong> ${isMatched ? 'Yes' : 'No'}</p>` +
      `<p><strong>Feedback note:</strong><br/>${safeNote ? escapeHtml(safeNote).replaceAll('\n', '<br/>') : '(no note)'}</p>` +
      `<p><strong>User:</strong> ${escapeHtml(safeUserName)} (${escapeHtml(safeUserEmail)})</p>`
  });
  return sendMail({ to, subject, text, html });
}

export async function sendEmergencySosEmail({
  to,
  senderName,
  groupActivity,
  lat,
  lng,
  mapsUrl
}) {
  const safeSender = String(senderName || 'A GoOut user').trim();
  const safeActivity = String(groupActivity || 'Buddy meetup').trim();
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  const fallbackMaps = Number.isFinite(safeLat) && Number.isFinite(safeLng) ?
    `https://www.google.com/maps?q=${safeLat},${safeLng}` :
    '';
  const safeMapsUrl = String(mapsUrl || fallbackMaps).trim();
  const locationLine = Number.isFinite(safeLat) && Number.isFinite(safeLng) ? `${safeLat}, ${safeLng}` : 'Location unavailable';

  const subject = `SOS alert from ${safeSender} (GoOut)`;
  const text =
    `${safeSender} pressed SOS (Need Help) in GoOut.\n\n` +
    `Activity: ${safeActivity}\n` +
    `Current location: ${locationLine}\n` +
    `${safeMapsUrl ? `Map link: ${safeMapsUrl}\n` : ''}\n` +
    'Please check on them immediately.';
  const html = renderEmailTemplate({
    preheader: `${safeSender} triggered SOS in GoOut`,
    badge: 'Emergency SOS',
    title: 'SOS Alert',
    subtitle: `${safeSender} asked for help during a GoOut meetup.`,
    accent: '#dc2626',
    bodyHtml:
      `<p><strong>${escapeHtml(safeSender)}</strong> pressed <strong>SOS — Need help</strong> in GoOut.</p>` +
      `<p><strong>Activity:</strong> ${escapeHtml(safeActivity)}</p>` +
      `<p><strong>Current location:</strong> ${escapeHtml(locationLine)}</p>` +
      '<p>Please contact them immediately.</p>',
    ctaLabel: safeMapsUrl ? 'Open location' : '',
    ctaUrl: safeMapsUrl || '',
    footerNote: 'This alert was sent because this email is listed as a GoOut emergency contact.'
  });
  return sendMail({ to, subject, text, html });
}