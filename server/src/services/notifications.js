const { User, SubscriptionPlan, MFSProvider, Discount } = require('../models');
const email = require('./email');
const settings = require('./settings');
const memoSvc = require('./memo');
const { money, discountLabel } = memoSvc;

// Who hears about new payments: the admin-set list, otherwise every active admin.
async function adminRecipients() {
  const listed = (await settings.get('app')).paymentNotifyEmails || [];
  if (listed.length) return listed;
  return (await User.find({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] }, disabledAt: null, emailVerifiedAt: { $ne: null } }).select('email').lean()).map((u) => u.email);
}
async function load({ userId, planId, discountId, providerId }) {
  const [user, plan, discount, provider] = await Promise.all([User.findById(userId).lean(), SubscriptionPlan.findById(planId).lean(), discountId ? Discount.findById(discountId).lean() : null, providerId ? MFSProvider.findById(providerId).lean() : null]);
  return { user, plan, discount, provider };
}
// Pure: the table an admin sees for a new payment.
function adminRows(o) {
  const d = discountLabel(o.discount); const when = (o.when || new Date()).toISOString().replace('T', ' ').slice(0, 16);
  return [['Order ID', o.orderId], ['Plan', o.plan.name], ['Amount', money(o.expectedMinor, o.currency)], o.amountMinor != null && o.amountMinor !== o.expectedMinor && ['Amount the customer says they sent', money(o.amountMinor, o.currency)],
    ['Transaction ID', o.reference], o.senderNumber && ['Sender number', o.senderNumber], o.provider && ['Paid via', o.provider.name], o.user.name && ['Customer name', o.user.name], ['Customer email', o.user.email],
    ['Discount used', d ? `${d} (-${money(o.discountMinor || 0, o.currency)})` : 'None'], ['Original price', money(o.originalMinor, o.currency)], ['Date (UTC)', when]].filter(Boolean);
}
const attach = async (m, appName) => ({ attachments: [{ filename: `memo-${m.orderId}.pdf`, content: await memoSvc.memoPdf(m, appName), contentType: 'application/pdf' }] });

// A customer submitted a manual (MFS) payment: tell the admins, and tell the customer it is under review.
async function manualSubmitted(mp) {
  const { user, plan, discount, provider } = await load(mp); if (!user || !plan) return;
  const rows = adminRows({ orderId: mp.orderId, plan, user, discount, provider, reference: mp.transactionId, senderNumber: mp.senderNumber, amountMinor: mp.amountMinor, expectedMinor: mp.expectedMinor, originalMinor: mp.originalPriceMinor, discountMinor: mp.discountMinor, currency: mp.currency, when: mp.submittedAt });
  const base = { orderId: mp.orderId, plan: plan.name, amountMinor: mp.expectedMinor, currency: mp.currency };
  const mine = memoSvc.buildMemo({ orderId: mp.orderId, user, plan, method: provider ? provider.name : 'Manual payment', reference: mp.transactionId, senderNumber: mp.senderNumber, discount, originalMinor: mp.originalPriceMinor, discountMinor: mp.discountMinor, finalMinor: mp.expectedMinor, currency: mp.currency, status: 'Under review', date: mp.submittedAt });
  await Promise.all([...(await adminRecipients()).map((a) => email.safe(email.sendOnce(`admin-new:${mp._id}:${a}`, 'adminNewPayment', a, { ...base, rows, headline: 'A customer submitted a manual payment and is waiting for your approval.' }))),
    email.safe(email.sendOnce(`mfs-submitted:${mp._id}`, 'paymentUnderReview', user.email, { ...base, userName: user.name, rows: mine.rows }))]);
}
// Approved: the customer's memo (email table + PDF attachment).
async function manualApproved(mp, sub) {
  const { user, plan, discount, provider } = await load(mp); if (!user || !plan) return;
  const m = memoSvc.buildMemo({ orderId: mp.orderId, user, plan, sub, method: provider ? provider.name : 'Manual payment', reference: mp.transactionId, senderNumber: mp.senderNumber, discount, originalMinor: mp.originalPriceMinor, discountMinor: mp.discountMinor, finalMinor: mp.expectedMinor, paidMinor: mp.amountMinor, currency: mp.currency, status: 'Approved', date: mp.reviewedAt });
  await email.safe(email.sendOnce(`memo-mfs:${mp._id}`, 'memo', user.email, { orderId: mp.orderId, userName: user.name, statusText: 'approved', memo: m }, await attach(m, (await settings.get('app')).appName)));
}
async function manualRejected(mp, note) {
  const user = await User.findById(mp.userId).lean(); if (!user) return;
  await email.safe(email.sendOnce(`mfs-rejected:${mp._id}`, 'paymentRejected', user.email, { orderId: mp.orderId, transactionId: mp.transactionId, note }));
}
// Online payment confirmed by the gateway: memo to the customer, heads-up to the admins.
async function sslPaid(p, sub) {
  const { user, plan, discount } = await load(p); if (!user || !plan) return; const orderId = p.orderId || p.tranId;
  const m = memoSvc.buildMemo({ orderId, user, plan, sub, method: 'Online payment (SSLCommerz)', reference: p.bankTranId || p.tranId, discount, originalMinor: p.originalPriceMinor, discountMinor: p.discountMinor, finalMinor: p.amountMinor, currency: p.currency, status: 'Paid', date: p.paidAt });
  const rows = adminRows({ orderId, plan, user, discount, reference: p.bankTranId || p.tranId, expectedMinor: p.amountMinor, originalMinor: p.originalPriceMinor, discountMinor: p.discountMinor, currency: p.currency, when: p.paidAt, provider: { name: 'SSLCommerz (online)' } });
  await Promise.all([email.safe(email.sendOnce(`memo-ssl:${p.tranId}`, 'memo', user.email, { orderId, userName: user.name, statusText: 'received', memo: m }, await attach(m, (await settings.get('app')).appName))),
    ...(await adminRecipients()).map((a) => email.safe(email.sendOnce(`admin-paid:${p.tranId}:${a}`, 'adminNewPayment', a, { orderId, plan: plan.name, amountMinor: p.amountMinor, currency: p.currency, rows, headline: 'A customer paid online. The plan was activated automatically.' })))]);
}
module.exports = { manualSubmitted, manualApproved, manualRejected, sslPaid, adminRows, adminRecipients };
