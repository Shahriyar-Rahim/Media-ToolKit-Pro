const { UsageRecord, Subscription, User } = require('../models');
const ent = require('./entitlement');
const settings = require('./settings');
const { HttpError } = require('../utils/errors');

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()), startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
async function counts(userId, source) {
  const now = new Date(), q = { userId }; if (source) q.source = source;
  const [today, month, total] = await Promise.all([UsageRecord.countDocuments({ ...q, at: { $gte: startOfDay(now) } }), UsageRecord.countDocuments({ ...q, at: { $gte: startOfMonth(now) } }), UsageRecord.countDocuments({ userId, source: 'FREE' })]);
  return { today, month, total };
}
async function current(user) {
  const subscriptions = await Subscription.find({ userId: user._id, status: { $in: ['ACTIVE'] } }).lean();
  const free = await settings.get('freeAccess');
  const hasSub = !!ent.pickSubscription(subscriptions);
  const usage = await counts(user._id, hasSub ? 'SUBSCRIPTION' : 'FREE');
  return ent.resolve({ user, subscriptions, free, usage });
}
// Check + record in one call. clientJobId makes retries idempotent; the unique index is the guard against races.
async function consume(user, { feature, also = [], clientJobId, fileSizeBytes }) {
  const e = await current(user);
  const dup = await UsageRecord.exists({ userId: user._id, clientJobId });
  if (dup) return { ok: true, duplicate: true, entitlement: e };
  const v = [feature, ...also].map((f) => ent.authorize(e, f, fileSizeBytes)).find((x) => !x.ok) || { ok: true }; if (!v.ok) throw new HttpError(402, v.reason, 'ENTITLEMENT_DENIED');
  try { await UsageRecord.create({ userId: user._id, feature, clientJobId, source: e.source === 'FREE' ? 'FREE' : 'SUBSCRIPTION', bytes: fileSizeBytes }); }
  catch (err) { if (err.code !== 11000) throw err; }
  return { ok: true, entitlement: await current(user) };
}
module.exports = { current, consume };
