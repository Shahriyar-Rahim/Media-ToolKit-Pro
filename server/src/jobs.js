const M = require('./models');
const subs = require('./services/subscriptions');
const checkout = require('./services/checkout');
const email = require('./services/email');
const settings = require('./services/settings');

// Hourly housekeeping. All steps are idempotent, so running on several instances or after a restart is safe.
async function tick() {
  await subs.expireDue(); await checkout.expireStalePayments();
  const days = (await settings.get('subscription')).expiryReminderDays, now = new Date();
  const soon = await M.Subscription.find({ status: 'ACTIVE', isLifetime: false, endsAt: { $gt: now, $lte: new Date(+now + days * 864e5) } }).populate('userId', 'email').lean();
  for (const s of soon) if (s.userId) await email.safe(email.sendOnce(`sub-expiring:${s._id}`, 'subscriptionExpiring', s.userId.email, { plan: s.planSnapshot.name, endsAt: s.endsAt }));
  const gone = await M.Subscription.find({ status: 'EXPIRED', endsAt: { $gt: new Date(+now - 2 * 864e5) } }).populate('userId', 'email').lean();
  for (const s of gone) if (s.userId) await email.safe(email.sendOnce(`sub-expired:${s._id}`, 'subscriptionExpired', s.userId.email, { plan: s.planSnapshot.name }));
}
module.exports = { start: () => { const run = () => tick().catch((e) => console.error('[jobs]', e.message)); run(); return setInterval(run, 3600e3).unref(); }, tick };
