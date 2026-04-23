import BuddyGroup from '../models/BuddyGroup.js';
import { sendMeetupReminderEmail } from '../utils/email.js';

const WINDOW_BEFORE_MS = 60 * 1000;
const WINDOW_AFTER_MS = 90 * 1000;
const REMINDER_CONFIGS = [
  {
    key: 'reminder1dSentTo',
    eventKey: '1d',
    leadMs: 24 * 60 * 60 * 1000,
    label: '1 day'
  },
  {
    key: 'reminder1hSentTo',
    eventKey: '1h',
    leadMs: 60 * 60 * 1000,
    label: '1 hour'
  },
  // Keep existing near-start reminder.
  {
    key: 'reminder10mSentTo',
    eventKey: '10m',
    leadMs: 10 * 60 * 1000,
    label: '10 minutes'
  }
];

function uniqUsers(users) {
  const m = new Map();
  (users || []).forEach((u) => {
    const id = String(u?._id || '');
    if (!id || m.has(id)) return;
    m.set(id, u);
  });
  return [...m.values()];
}

export async function runBuddyMeetupReminderSweep(io) {
  for (const config of REMINDER_CONFIGS) {
    const nowMs = Date.now();
    const windowStart = new Date(nowMs + config.leadMs - WINDOW_BEFORE_MS);
    const windowEnd = new Date(nowMs + config.leadMs + WINDOW_AFTER_MS);

    const groups = await BuddyGroup.find({
      scheduledAt: { $gte: windowStart, $lte: windowEnd },
      status: { $in: ['open', 'full', 'ongoing'] }
    })
      .select(`activity scheduledAt meetingPlace safeVenue creatorId members ${config.key}`)
      .populate('creatorId', 'name email')
      .populate('members', 'name email')
      .lean();

    for (const group of groups) {
      const already = new Set((group?.[config.key] || []).map((id) => String(id)));
      const recipients = uniqUsers([group.creatorId, ...(group.members || [])]);
      const toMarkSent = [];
      const { label } = config;
      const when = new Date(group?.scheduledAt);
      const whenText = Number.isNaN(when.getTime()) ? 'soon' : when.toLocaleString();
      const place = String(group?.safeVenue?.name || group?.meetingPlace || '').trim() || 'your meetup location';
      const activity = String(group?.activity || 'Buddy meetup').trim();

      for (const user of recipients) {
        const uid = String(user?._id || '');
        if (!uid || already.has(uid)) continue;

        if (user?.email) {
          try {
            await sendMeetupReminderEmail({
              to: user.email,
              activity,
              whenText,
              place,
              label
            });
          } catch (e) {
            console.error('[buddy-reminder] email send failed', uid, e?.message || e);
          }
        }

        try {
          io.to(`user-${uid}`).emit('buddy-meet-reminder', {
            groupId: String(group._id),
            activity: String(group.activity || 'Buddy meetup'),
            scheduledAt: group.scheduledAt,
            venueName: String(group?.safeVenue?.name || group?.meetingPlace || '').trim(),
            reminderType: config.eventKey
          });
        } catch (e) {
          console.error('[buddy-reminder] socket emit failed', uid, e?.message || e);
        }

        toMarkSent.push(uid);
      }

      if (toMarkSent.length) {
        await BuddyGroup.updateOne(
          { _id: group._id },
          { $addToSet: { [config.key]: { $each: toMarkSent } } }
        );
      }
    }
  }
}

