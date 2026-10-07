const { Subscription, SubscriptionPlan, Discount, User } = require('../models');
const { conflict, bad, missing } = require('../utils/errors');
const email = require('./email');
const ent = require('./entitlement');
const pricing = require('./pricing');

const snapshot = (plan) => ({ name: plan.name, slug: plan.slug, rank: plan.rank, entitlements: JSON.parse(JSON.stringify(plan.entitlements || {})) });

// Checkout guard: plan must be purchasable now, and the user must not already hold an equal/higher lifetime entitlement.
async function assertPurchasable(user, plan, finalPriceMinor) {
  if (!plan || !plan.active || plan.archivedAt) throw bad('This plan is not available', 'PLAN_UNAVAILABLE');
  const subs = await Subscription.find({ userId: user._id, status: 'ACTIVE' }).lean();
  const lifetime = subs.filter((s) => ent.isActive(s, new Date()) && s.isLifetime && ((s.planSnapshot && s.planSnapshot.rank) || 0) >= plan.rank);
  if (lifetime.length) throw conflict('You already have lifetime access that includes this plan', 'ALREADY_ENTITLED');
  if (plan.oneTimePerUser && await Subscription.exists({ userId: user._id, planId: plan._id, status: { $in: ['ACTIVE', 'EXPIRED', 'CANCELLED'] } }))
    throw conflict('This plan can only be claimed once per account', 'ONE_TIME_ONLY');
}

// Idempotent by paymentKey: the same payment can never yield two subscriptions.
// Same-plan renewal stacks onto the current end date so paid time is never lost.
async function activate({ userId, plan, paymentKey, method, price, discountId, grantedBy, orderId }) {
  const existing = await Subscription.findOne({ paymentKey }); if (existing) return existing;
  const now = new Date();
  let startsAt = now, endsAt = null;
  if (!plan.isLifetime) {
    const cur = await Subscription.findOne({ userId, planId: plan._id, status: 'ACTIVE', isLifetime: false, endsAt: { $gt: now } }).sort({ endsAt: -1 });
    startsAt = cur ? cur.endsAt : now; endsAt = new Date(startsAt.getTime() + plan.billingPeriodDays * 864e5);
  }
  let sub;
  try {
    sub = await Subscription.create({ userId, planId: plan._id, planSnapshot: snapshot(plan), status: 'ACTIVE', startsAt: startsAt > now ? now : startsAt, endsAt, isLifetime: plan.isLifetime,
      paymentKey, orderId, paymentMethod: method, originalPriceMinor: price.originalPriceMinor, discountMinor: price.discountMinor, finalPriceMinor: price.finalPriceMinor, currency: price.currency, discountId, grantedBy });
  } catch (e) { if (e.code === 11000) return Subscription.findOne({ paymentKey }); throw e; } // lost a race: return the winner
  sub.justCreated = true; // not persisted: lets callers tell "I created this" from "a concurrent request already did"
  const user = await User.findById(userId).lean();
  if (user) await email.safe(email.sendOnce(`sub-activated:${sub._id}`, 'subscriptionActivated', user.email, { plan: plan.name, endsAt: sub.endsAt }));
  return sub;
}

async function revoke(subId, reason) {
  const s = await Subscription.findOneAndUpdate({ _id: subId, status: 'ACTIVE' }, { status: 'CANCELLED', revokedAt: new Date(), revokedReason: reason }, { new: true });
  if (!s) throw missing('No active subscription to revoke'); return s;
}
const expireDue = () => Subscription.updateMany({ status: 'ACTIVE', isLifetime: false, endsAt: { $lte: new Date() } }, { status: 'EXPIRED' });
module.exports = { activate, assertPurchasable, revoke, expireDue, snapshot };
