const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const M = require('../models');
const { audit } = require('../services/audit');
const settings = require('../services/settings');
const subs = require('../services/subscriptions');
const checkout = require('../services/checkout');
const usage = require('../services/usage');
const email = require('../services/email');
const pricing = require('../services/pricing');
const { missing, bad, conflict, forbid } = require('../utils/errors');
const refunds = require('../services/refunds');
const reauth = require('../services/reauth');
const env = require('../config/env');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // user text is never used as a raw regex
async function paged(Model, filter, q, opts = {}) {
  const { page, limit, sort } = q; const sortKey = { old: { createdAt: 1 }, new: { createdAt: -1 } }[sort] || { createdAt: -1 };
  const [items, total] = await Promise.all([Model.find(filter).sort(sortKey).skip((page - 1) * limit).limit(limit).populate(opts.populate || '').select(opts.select || '').lean(), Model.countDocuments(filter)]);
  return { items, total, page, pages: Math.ceil(total / limit) };
}
const crud = (Model, name, target) => ({
  list: asyncHandler(async (req, res) => res.json({ items: await Model.find().sort({ sortOrder: 1, createdAt: -1 }).lean() })),
  create: asyncHandler(async (req, res) => { const d = await Model.create(req.body).catch((e) => { if (e.code === 11000) throw conflict(`${name} already exists`); throw e; }); await audit(req, `${target}.created`, name, d._id, req.body); res.status(201).json(d); }),
  update: asyncHandler(async (req, res) => {
    const { expectedUpdatedAt, ...body } = req.body; const f = { _id: req.params.id }; // optimistic concurrency for two admins editing at once
    if (expectedUpdatedAt) f.updatedAt = new Date(expectedUpdatedAt);
    const d = await Model.findOneAndUpdate(f, { $set: body }, { new: true, runValidators: true }); if (!d) { if (await Model.exists({ _id: req.params.id })) throw conflict('Changed by someone else. Reload and retry.', 'STALE'); throw missing(); }
    await audit(req, `${target}.updated`, name, d._id, body); res.json(d);
  }),
  remove: asyncHandler(async (req, res) => { const d = await Model.findByIdAndDelete(req.params.id); if (!d) throw missing(); await audit(req, `${target}.deleted`, name, req.params.id); res.json({ ok: true }); }),
});

exports.dashboard = asyncHandler(async (_req, res) => {
  await subs.expireDue(); const now = new Date(), d30 = new Date(now - 30 * 864e5);
  const [users, active, activeSubs, expiredSubs, pendingManual, sslPaid, revenue, plans, bugs, contacts, recent, popular] = await Promise.all([
    M.User.countDocuments(), M.User.countDocuments({ lastLoginAt: { $gte: d30 } }), M.Subscription.countDocuments({ status: 'ACTIVE' }), M.Subscription.countDocuments({ status: 'EXPIRED' }),
    M.ManualPayment.countDocuments({ status: 'PENDING' }), M.Payment.countDocuments({ status: 'PAID' }),
    Promise.all([M.Payment.aggregate([{ $match: { status: 'PAID' } }, { $group: { _id: '$currency', t: { $sum: '$amountMinor' } } }]), M.ManualPayment.aggregate([{ $match: { status: 'APPROVED' } }, { $group: { _id: '$currency', t: { $sum: '$expectedMinor' } } }])]),
    M.SubscriptionPlan.countDocuments({ active: true, archivedAt: null }), M.BugReport.countDocuments({ status: { $in: ['OPEN', 'IN_REVIEW', 'IN_PROGRESS'] } }), M.ContactMessage.countDocuments({ status: 'OPEN' }),
    M.AuditLog.find().sort({ at: -1 }).limit(10).lean(), M.Subscription.aggregate([{ $group: { _id: '$planSnapshot.name', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }]),
  ]);
  const rev = {}; revenue.flat().forEach((r) => { rev[r._id] = (rev[r._id] || 0) + r.t; });
  const refunded = {}; (await Promise.all([M.Payment.aggregate([{ $match: { status: 'REFUNDED' } }, { $group: { _id: '$currency', t: { $sum: '$amountMinor' } } }]), M.ManualPayment.aggregate([{ $match: { status: 'REFUNDED' } }, { $group: { _id: '$currency', t: { $sum: '$expectedMinor' } } }])])).flat().forEach((r) => { refunded[r._id] = (refunded[r._id] || 0) + r.t; });
  res.json({ refundedMinor: refunded, users, activeUsers30d: active, activeSubs, expiredSubs, pendingManual, sslPaid, revenueMinor: rev, activePlans: plans, openBugs: bugs, openContacts: contacts, popularPlans: popular, recent });
});

exports.users = asyncHandler(async (req, res) => { const { q, status } = req.query; const f = {}; if (q) f.email = new RegExp(esc(q), 'i'); if (status === 'disabled') f.disabledAt = { $ne: null }; if (status === 'unverified') f.emailVerifiedAt = null; res.json(await paged(M.User, f, req.query, { select: 'email name role emailVerifiedAt disabledAt lastLoginAt createdAt' })); });
exports.user = asyncHandler(async (req, res) => {
  const u = await M.User.findById(req.params.id).select('+sessions').lean(); if (!u) throw missing();
  const [subscriptions, ssl, manual, ent] = await Promise.all([M.Subscription.find({ userId: u._id }).sort({ createdAt: -1 }).lean(), M.Payment.find({ userId: u._id }).sort({ createdAt: -1 }).limit(50).lean(), M.ManualPayment.find({ userId: u._id }).sort({ createdAt: -1 }).limit(50).lean(), usage.current(u)]);
  res.json({ user: { id: u._id, email: u.email, name: u.name, role: u.role, emailVerifiedAt: u.emailVerifiedAt, disabledAt: u.disabledAt, lastLoginAt: u.lastLoginAt, lastLoginIp: u.lastLoginIp, lastSeenAt: u.lastSeenAt, lastSeenIp: u.lastSeenIp, createdAt: u.createdAt, sessions: (u.sessions || []).map(({ ua, ip, createdAt, expiresAt }) => ({ ua, ip, createdAt, expiresAt })) }, subscriptions, payments: { ssl, manual }, entitlement: ent });
});
exports.setDisabled = (disable) => asyncHandler(async (req, res) => {
  const u = await M.User.findById(req.params.id); if (!u) throw missing();
  if (String(u._id) === String(req.user._id)) throw bad("You can't disable your own account");
  if (u.role !== 'CUSTOMER' && req.user.role !== 'SUPER_ADMIN') throw forbid('Only a super admin can change admin accounts');
  u.disabledAt = disable ? new Date() : null; if (disable) u.sessions = []; await u.save(); await audit(req, disable ? 'user.disabled' : 'user.enabled', 'User', u._id); res.json({ ok: true });
});
exports.grant = asyncHandler(async (req, res) => {
  const plan = await M.SubscriptionPlan.findById(req.body.planId); if (!plan) throw missing('Plan not found');
  const u = await M.User.findById(req.params.id); if (!u) throw missing();
  const sub = await subs.activate({ userId: u._id, plan, paymentKey: `grant:${crypto.randomUUID()}`, method: 'ADMIN_GRANT', grantedBy: req.user._id, price: { originalPriceMinor: plan.priceMinor, discountMinor: plan.priceMinor, finalPriceMinor: 0, currency: plan.currency } });
  await audit(req, 'subscription.granted', 'Subscription', sub._id, { userId: u._id, plan: plan.slug }); res.status(201).json(sub);
});
exports.revoke = asyncHandler(async (req, res) => { const s = await subs.revoke(req.params.id, req.body.reason || 'Revoked by admin'); await audit(req, 'subscription.revoked', 'Subscription', s._id, { reason: s.revokedReason }); res.json(s); });

// ---- plans / discounts / mfs / faq ----
const plans = crud(M.SubscriptionPlan, 'Plan', 'plan');
exports.plans = { ...plans, list: asyncHandler(async (_req, res) => res.json({ items: await M.SubscriptionPlan.find().sort({ sortOrder: 1 }).lean() })),
  archive: asyncHandler(async (req, res) => { const p = await M.SubscriptionPlan.findByIdAndUpdate(req.params.id, { archivedAt: new Date(), active: false }, { new: true }); if (!p) throw missing(); await audit(req, 'plan.archived', 'Plan', p._id); res.json(p); }), // never hard-delete: subscriptions keep a snapshot, but admins keep the record too
  remove: undefined };
const disc = crud(M.Discount, 'Discount', 'discount');
exports.discounts = { ...disc, list: asyncHandler(async (_req, res) => { const items = await M.Discount.find().sort({ createdAt: -1 }).lean(); res.json({ items: items.map((d) => ({ ...d, remaining: d.maxRedemptions != null ? Math.max(0, d.maxRedemptions - d.redeemedCount) : null })) }); }) };
exports.mfs = { ...crud(M.MFSProvider, 'MFS provider', 'mfs'), reorder: asyncHandler(async (req, res) => { await Promise.all(req.body.ids.map((id, i) => M.MFSProvider.updateOne({ _id: id }, { sortOrder: i }))); await audit(req, 'mfs.reordered', 'MFSProvider', null); res.json({ ok: true }); }) };
exports.faq = crud(M.FAQ, 'FAQ', 'faq');

// ---- payments ----
exports.sslPayments = asyncHandler(async (req, res) => { const f = {}; if (req.query.status) f.status = req.query.status; if (req.query.q) { const rx = new RegExp(esc(req.query.q), 'i'); f.$or = [{ orderId: rx }, { tranId: rx }]; } res.json(await paged(M.Payment, f, req.query, { populate: [{ path: 'userId', select: 'email name' }, { path: 'discountId', select: 'code name' }], select: '-validation -gatewayUrl' })); });
exports.manualPayments = asyncHandler(async (req, res) => { const f = {}; if (req.query.status) f.status = req.query.status; if (req.query.q) { const rx = new RegExp(esc(req.query.q), 'i'); f.$or = [{ orderId: rx }, { transactionId: rx }, { senderNumber: rx }]; } res.json(await paged(M.ManualPayment, f, req.query, { populate: [{ path: 'userId', select: 'email name' }, { path: 'providerId', select: 'name' }, { path: 'planId', select: 'name' }, { path: 'discountId', select: 'code name' }] })); });
exports.reviewManual = asyncHandler(async (req, res) => { const mp = await checkout.reviewManual(req.params.id, req.user, { approve: req.body.approve, note: req.body.note }); await audit(req, req.body.approve ? 'payment.approved' : 'payment.rejected', 'ManualPayment', mp._id, { txn: mp.transactionId }); res.json(mp); });
exports.gateways = asyncHandler(async (_req, res) => { const rows = await M.PaymentGatewayConfig.find().lean(); res.json({ SSLCOMMERZ: !!(rows.find((r) => r.key === 'SSLCOMMERZ') || {}).enabled, MFS: !!(rows.find((r) => r.key === 'MFS') || {}).enabled }); });
exports.setGateway = asyncHandler(async (req, res) => { await M.PaymentGatewayConfig.findOneAndUpdate({ key: req.params.key }, { enabled: req.body.enabled, updatedBy: req.user._id }, { upsert: true }); await audit(req, `gateway.${req.body.enabled ? 'enabled' : 'disabled'}`, 'PaymentGateway', req.params.key); res.json({ ok: true }); });

// ---- settings, support, audit ----
exports.getSettings = asyncHandler(async (_req, res) => res.json({ app: await settings.get('app'), security: await settings.get('security'), freeAccess: await settings.get('freeAccess'), subscription: await settings.get('subscription') }));
exports.putSettings = asyncHandler(async (req, res) => { const cur = await settings.get(req.params.group); const v = await settings.set(req.params.group, { ...cur, ...req.body }, req.user._id); await audit(req, 'settings.changed', 'Settings', req.params.group, req.body); res.json(v); });
const support = (Model, key, opts = {}) => ({
  list: asyncHandler(async (req, res) => { const f = {}; if (req.query.status) f.status = req.query.status; if (req.query.q) f.$or = [{ [key]: new RegExp(esc(req.query.q), 'i') }, { title: new RegExp(esc(req.query.q), 'i') }, { subject: new RegExp(esc(req.query.q), 'i') }]; res.json(await paged(Model, f, req.query)); }),
  get: asyncHandler(async (req, res) => { const q = Model.findById(req.params.id); if (opts.screenshot) q.select('+screenshot'); const d = await q.lean(); if (!d) throw missing(); res.json(d); }),
  update: asyncHandler(async (req, res) => { const d = await Model.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true }); if (!d) throw missing(); await audit(req, `${key}.updated`, Model.modelName, d._id, req.body); res.json(d); }),
  reply: asyncHandler(async (req, res) => {
    const d = await Model.findById(req.params.id); if (!d) throw missing(); d.replies.push({ by: req.user._id, message: req.body.message, at: new Date() }); if (req.body.status) d.status = req.body.status; await d.save();
    const to = d.email || (d.userId && (await M.User.findById(d.userId).lean() || {}).email); if (to) await email.safe(email.send('adminReply', to, { subject: d.subject || d.title, message: req.body.message }));
    await audit(req, `${key}.replied`, Model.modelName, d._id); res.json(d);
  }),
});
exports.bugs = support(M.BugReport, 'reportId', { screenshot: true }); exports.contacts = support(M.ContactMessage, 'ticketId'); exports.tickets = support(M.SupportTicket, 'ticketId');
exports.audit = asyncHandler(async (req, res) => { const f = {}; if (req.query.q) f.action = new RegExp(esc(req.query.q), 'i'); res.json(await paged(M.AuditLog, f, { ...req.query, sort: 'new' }, {})); });
exports.reports = asyncHandler(async (_req, res) => {
  const [byMethod, byStatus, freeUsage, failed] = await Promise.all([M.Subscription.aggregate([{ $group: { _id: '$paymentMethod', n: { $sum: 1 }, revenue: { $sum: '$finalPriceMinor' } } }]), M.Subscription.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]), M.UsageRecord.countDocuments({ source: 'FREE' }), M.Payment.countDocuments({ status: { $in: ['FAILED', 'CANCELLED', 'EXPIRED'] } })]);
  res.json({ byMethod, byStatus, freeOperations: freeUsage, failedPayments: failed });
});

// ---- refunds, re-confirmation, access reset, assignment, version ----
exports.refundSsl = asyncHandler(async (req, res) => { const p = await refunds.refundSsl(req.params.id, req.user, req.body); await audit(req, 'payment.refunded', 'Payment', p._id, { tranId: p.tranId, amountMinor: p.amountMinor, reason: req.body.reason, viaGateway: req.body.viaGateway, gateway: p.refundGatewayStatus }); res.json(p); });
exports.refundManual = asyncHandler(async (req, res) => { const p = await refunds.refundManual(req.params.id, req.user, req.body); await audit(req, 'payment.refunded', 'ManualPayment', p._id, { txn: p.transactionId, amountMinor: p.expectedMinor, reason: req.body.reason }); res.json(p); });
exports.reauthRequest = asyncHandler(async (req, res) => { await reauth.request(req.user); res.json({ ok: true }); });
exports.reauthConfirm = asyncHandler(async (req, res) => { const until = await reauth.confirm(req.user, req.body.code); await audit(req, 'admin.reauth', 'User', req.user._id); res.json({ ok: true, until }); });
exports.resetAccess = asyncHandler(async (req, res) => {
  const u = await M.User.findById(req.params.id); if (!u) throw missing();
  if (u.role !== 'CUSTOMER' && req.user.role !== 'SUPER_ADMIN') throw forbid('Only a super admin can change admin accounts');
  await M.User.updateOne({ _id: u._id }, { sessions: [], failedLogins: 0, lockUntil: null, ...(req.body.forcePasswordReset ? { mustResetPassword: true } : {}) });
  await audit(req, 'user.access_reset', 'User', u._id, { forcePasswordReset: req.body.forcePasswordReset }); res.json({ ok: true });
});
exports.assignBug = asyncHandler(async (req, res) => {
  if (req.body.assignedTo) { const a = await M.User.findById(req.body.assignedTo).lean(); if (!a || !['ADMIN', 'SUPER_ADMIN'].includes(a.role)) throw bad('Can only assign to an admin'); }
  const b = await M.BugReport.findByIdAndUpdate(req.params.id, { assignedTo: req.body.assignedTo }, { new: true }); if (!b) throw missing();
  await audit(req, 'bug.assigned', 'BugReport', b._id, { assignedTo: req.body.assignedTo }); res.json(b);
});
exports.version = asyncHandler(async (_req, res) => res.json({ server: env.appVersion, minDesktopVersion: (await settings.get('app')).minDesktopVersion }));
