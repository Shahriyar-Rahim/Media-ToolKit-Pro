const { Payment, ManualPayment, Subscription, SubscriptionPlan, User } = require('../models');
const { bad, missing, conflict, HttpError } = require('../utils/errors');
const ssl = require('./sslcommerz');
const email = require('./email');
const { releaseDiscount } = require('./checkout');

// Ends the access the payment bought, restores the discount use, and tells the customer. Safe to run twice.
async function finish(Model, p, { reason, viaGateway, amountMinor, currency, key }) {
  if (p.subscriptionId) await Subscription.updateOne({ _id: p.subscriptionId, status: { $in: ['ACTIVE', 'EXPIRED'] } }, { status: 'REFUNDED', revokedAt: new Date(), revokedReason: `Refunded: ${reason}` }); // history stays; only the status changes
  await releaseDiscount(Model, p);
  const [u, plan] = await Promise.all([User.findById(p.userId).lean(), SubscriptionPlan.findById(p.planId).lean()]);
  if (u) await email.safe(email.sendOnce(`refund:${key}`, 'refundProcessed', u.email, { amountMinor, currency, plan: plan ? plan.name : 'plan', viaGateway, orderId: p.orderId }));
}

// SSLCommerz: the order of steps keeps our records honest if anything fails midway.
//  1. claim (PAID -> REFUNDING with a 60s lock, so two admins can't both send money back)
//  2. if a refund was already sent earlier, ask the gateway before re-sending (no double refund on retry)
//  3. otherwise request the refund; only a gateway success/processing moves us to REFUNDED
async function refundSsl(id, admin, { reason, viaGateway = true }) {
  const p0 = await Payment.findById(id); if (!p0) throw missing('Payment not found');
  if (p0.status === 'REFUNDED') throw conflict('This payment is already refunded', 'ALREADY_REFUNDED');
  if (!['PAID', 'REFUNDING'].includes(p0.status)) throw bad('Only paid payments can be refunded', 'NOT_REFUNDABLE');
  const now = new Date();
  const p = await Payment.findOneAndUpdate({ _id: id, $or: [{ status: 'PAID' }, { status: 'REFUNDING', refundLockUntil: { $lt: now } }] },
    { status: 'REFUNDING', refundLockUntil: new Date(+now + 60000), refundReason: reason, refundedBy: admin._id, refundRef: p0.refundRef || `RF-${p0.tranId}` }, { new: true });
  if (!p) throw conflict('A refund for this payment is already in progress', 'REFUND_IN_PROGRESS');
  const revert = (err) => Payment.updateOne({ _id: id }, { status: 'PAID', refundLockUntil: null, refundError: err });
  let gatewayState = 'MANUAL';
  if (viaGateway) {
    if (!ssl.configured()) { await revert('gateway not configured'); throw bad('SSLCommerz credentials are not configured on the server. Refund manually and choose "already refunded outside the app".', 'GATEWAY_NOT_CONFIGURED'); }
    if (!p.bankTranId) { await revert('missing bank transaction id'); throw bad('This payment has no bank transaction id, so the gateway cannot refund it. Refund manually.', 'NO_BANK_TRAN_ID'); }
    try {
      let r = null;
      if (p.refundSentAt) { try { r = ssl.interpretRefund(await ssl.refundStatus(p.refundRef)); } catch { throw new Error('status-unreachable'); } if (r.state === 'FAILED') r = null; } // gateway doesn't know it: safe to send
      if (!r) {
        await Payment.updateOne({ _id: id }, { refundSentAt: new Date() }); // marked BEFORE sending: a crash after this point makes retries check first
        r = ssl.interpretRefund(await ssl.refund({ bankTranId: p.bankTranId, amountMinor: p.amountMinor, reason, refId: p.refundRef }));
        if (r.state === 'FAILED') { await Payment.updateOne({ _id: id }, { refundSentAt: null }); await revert(r.reason); throw bad(`SSLCommerz did not accept the refund: ${r.reason}`, 'GATEWAY_REFUSED'); }
      }
      gatewayState = r.state;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      await Payment.updateOne({ _id: id }, { refundLockUntil: new Date(), refundError: 'gateway unreachable' }); // stays REFUNDING: unknown outcome, retry is safe
      throw new HttpError(502, 'Could not confirm the refund with SSLCommerz. It is marked "refunding"; try again in a minute and it will check the gateway before doing anything.', 'GATEWAY_UNREACHABLE');
    }
  }
  await Payment.updateOne({ _id: id, status: 'REFUNDING' }, { status: 'REFUNDED', refundedAt: new Date(), refundGatewayStatus: gatewayState, refundLockUntil: null, refundError: null });
  await finish(Payment, p, { reason, viaGateway, amountMinor: p.amountMinor, currency: p.currency, key: String(p._id) });
  return Payment.findById(id);
}

// Manual MFS: there is no API, the admin sends the money back themselves and records it here.
async function refundManual(id, admin, { reason }) {
  const mp0 = await ManualPayment.findById(id); if (!mp0) throw missing('Payment not found');
  if (mp0.status === 'REFUNDED') throw conflict('This payment is already refunded', 'ALREADY_REFUNDED');
  const mp = await ManualPayment.findOneAndUpdate({ _id: id, status: 'APPROVED' }, { status: 'REFUNDED', refundedAt: new Date(), refundedBy: admin._id, refundReason: reason }, { new: true });
  if (!mp) throw bad('Only approved payments can be refunded', 'NOT_REFUNDABLE');
  await finish(ManualPayment, mp, { reason, viaGateway: false, amountMinor: mp.expectedMinor, currency: mp.currency, key: String(mp._id) });
  return mp;
}
module.exports = { refundSsl, refundManual };
