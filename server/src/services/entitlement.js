const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { FEATURES } = require('../config/constants');

const isActive = (s, now) => s.status === 'ACTIVE' && (s.isLifetime || (s.endsAt && s.endsAt > now)) && !s.revokedAt && (!s.startsAt || s.startsAt <= now);
const rankOf = (s) => (s.planSnapshot && s.planSnapshot.rank) || 0;

// Highest-rank active subscription wins (lifetime breaks ties). Pure.
function pickSubscription(subs, now = new Date()) {
  return subs.filter((s) => isActive(s, now)).sort((a, b) => rankOf(b) - rankOf(a) || Number(b.isLifetime) - Number(a.isLifetime))[0] || null;
}

function freeWindow(user, free, now) {
  if (!free || !free.enabled || !user.freeTrialStartedAt) return null;
  const end = free.trialDays ? new Date(user.freeTrialStartedAt.getTime() + free.trialDays * 864e5) : null;
  return end && now > end ? { expired: true, endsAt: end } : { expired: false, endsAt: end };
}

// Returns the effective entitlement from the loaded facts. Pure: no DB, no clock reads except `now` arg.
function resolve({ user, subscriptions, free, usage, now = new Date() }) {
  const sub = pickSubscription(subscriptions, now);
  if (sub) {
    const e = sub.planSnapshot.entitlements || {};
    return { source: 'SUBSCRIPTION', planName: sub.planSnapshot.name, lifetime: sub.isLifetime, endsAt: sub.isLifetime ? null : sub.endsAt,
      features: e.features || {}, limits: e.limits || {}, usage };
  }
  const w = freeWindow(user, free, now);
  const allowed = new Set((free && free.allowedFeatures) || []);
  const totalCap = free && free.operationCount != null ? free.operationCount : null;
  const trialOk = w && !w.expired && (totalCap == null || usage.total < totalCap);
  return { source: trialOk ? 'FREE' : 'NONE', planName: trialOk ? 'Free trial' : null, lifetime: false, endsAt: w ? w.endsAt : null,
    trialExpired: !!(w && w.expired), features: trialOk ? Object.fromEntries(FEATURES.map((f) => [f, allowed.has(f)])) : {},
    limits: trialOk ? { dailyJobs: free.dailyLimit, monthlyJobs: free.monthlyLimit, maxFileSizeMB: free.maxFileSizeMB, totalJobs: totalCap } : {}, usage };
}

const canUseFeature = (ent, feature) => !!ent.features[feature];

// Structured verdict; `reason` is safe to show to users.
function authorize(ent, feature, fileSizeBytes = 0) {
  if (ent.source === 'NONE') return { ok: false, reason: ent.trialExpired ? 'Your free trial has ended. Choose a plan to continue.' : 'No active plan. Choose a plan to continue.' };
  if (!canUseFeature(ent, feature)) return { ok: false, reason: 'Your plan does not include this tool.' };
  const l = ent.limits, u = ent.usage;
  if (l.maxFileSizeMB != null && fileSizeBytes > l.maxFileSizeMB * 1048576) return { ok: false, reason: `File is larger than your ${l.maxFileSizeMB} MB limit.` };
  if (l.dailyJobs != null && u.today >= l.dailyJobs) return { ok: false, reason: 'Daily limit reached. Try again tomorrow or upgrade.' };
  if (l.monthlyJobs != null && u.month >= l.monthlyJobs) return { ok: false, reason: 'Monthly limit reached.' };
  if (l.totalJobs != null && u.total >= l.totalJobs) return { ok: false, reason: 'Free operations used up. Choose a plan to continue.' };
  return { ok: true };
}
const remaining = (ent) => { const l = ent.limits, u = ent.usage, r = {}; if (l.dailyJobs != null) r.today = Math.max(0, l.dailyJobs - u.today); if (l.monthlyJobs != null) r.month = Math.max(0, l.monthlyJobs - u.month); if (l.totalJobs != null) r.total = Math.max(0, l.totalJobs - u.total); return r; };

// Offline cache: ES256-signed snapshot the desktop can verify with the embedded PUBLIC key. Short life bounds abuse.
function signSnapshot(userId, ent, hours = 72) {
  if (!env.entitlementPrivateKey) return null;
  const { usage, ...rest } = ent;
  return jwt.sign({ sub: String(userId), ent: rest, remaining: remaining(ent) }, env.entitlementPrivateKey, { algorithm: 'ES256', expiresIn: `${hours}h` });
}
const verifySnapshot = (token, pub = env.entitlementPublicKey) => jwt.verify(token, pub, { algorithms: ['ES256'] });

module.exports = { pickSubscription, resolve, canUseFeature, authorize, remaining, signSnapshot, verifySnapshot, isActive };
