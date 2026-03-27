import nodemailer from 'nodemailer';

const clientUrl = () => process.env.CLIENT_URL || 'http://localhost:5173';

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export function isEmailConfigured() {
  return !!getTransporter();
}

export async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!transporter || !from) {
    console.warn('[email] SMTP not configured; skipped send to', to, subject);
    return { skipped: true };
  }
  await transporter.sendMail({ from, to, subject, text, html });
  return { sent: true };
}

export async function sendPasswordResetEmail(to, rawToken) {
  const link = `${clientUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const subject = 'Reset your GoOut password';
  const text = `We received a request to reset your password.\n\nOpen this link (valid for 1 hour):\n${link}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<p>We received a request to reset your GoOut password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>`;
  return sendMail({ to, subject, text, html });
}

export async function sendLoginOtpEmail(to, otp) {
  const subject = 'Your GoOut sign-in code';
  const text = `Your sign-in code is: ${otp}\n\nIt expires in 10 minutes. If you did not try to sign in, change your password.`;
  const html = `<p>Your sign-in code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${otp}</p><p>It expires in 10 minutes. If you did not try to sign in, change your password.</p>`;
  return sendMail({ to, subject, text, html });
}
