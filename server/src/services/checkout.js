const crypto = require('crypto');
const { SubscriptionPlan, Discount, Payment, ManualPayment, MFSProvider, PaymentGatewayConfig, Subscription, User } = require('../models');
const { bad, missing, conflict } = require('../utils/errors');
const pricing = require('./pricing');
const subs = require('./subscriptions');
const ssl = require('./sslcommerz');
const email = require('./email');
const notify = require('./notifications');
const { newOrderId } = require('../utils/identity');

async function gatewayState() {
  const rows = await PaymentGatewayConfig.find().lean(); const on = (k) => !!(rows.find((r) => r.key === k) || {}).enabled;
  const providers = on('MFS') ? await MFSProvider.find({ enabled: true }).sort({ sortOrder: 1 }).select('name accountType sortOrder').lean() : [];
  return { sslcommerz: on('SSLCOMMERZ') && ssl.configured(), mfs: on('MFS') && providers.length > 0, providers,
    message: !(on('SSLCOMMERZ') && ssl.configured()) && !(on('MFS') && providers.length) ? 'Online payment is temporarily unavailable. Please contact support.' : null };
}

// ---- discount uses are RESERVED atomically when checkout starts, so the cap can never be overshot ----
async function reserveDiscount(discount) {
  if (!discount) return;
  const hit = await Discount.findOneAndUpdate({ _id: discount._id, enabled: true, $or: [{ maxRedemptions: { $exists: false } }, { maxRedemptions: null }, { $expr: { $lt: ['$redeemedCount', '$maxRedemptions'] } }] }, { $inc: { redeemedCount: 1 } });
  if (!hit) throw bad('Discount usage limit reached', 'DISCOUNT_INVALID');
}
const unreserve = (discountId) => discountId ? Discount.updateOne({ _id: discountId, redeemedCount: { $gt: 0 } }, { $inc: { redeemedCount: -1 } }) : null;
// Release at most once per payment record (claim the flag first), whatever path ends the checkout.
async function releaseDiscount(Model, doc) {
  if (!doc || !doc.discountId) return;
  if (await Model.findOneAndUpdate({ _id: doc._id, discountReleasedAt: null }, { discountReleasedAt: new Date() })) await unreserve(doc.discountId);
}

// Every payment attempt gets a human-friendly order number (retry on the rare collision; other duplicate errors pass through).
async function createWithOrder(Model, data) {
  for (let i = 0; i < 5; i++) { try { return await Model.create({ ...data, orderId: newOrderId() }); } catch (e) { if (e.code === 11000 && e.keyPattern && e.keyPattern.orderId) continue; throw e; } }
  throw new Error('Could not allocate an order number');
}

// Server computes everything. The client only supplies ids and a discount code string.
async function quote(user, { planId, discountCode }) {
  const plan = await SubscriptionPlan.findById(planId); if (!plan) throw missing('Plan not found');
  let discount = null, used = 0;
  if (discountCode) {
    discount = await Discount.findOne({ code: discountCode.trim().toUpperCase() });
    if (discount) { // uses by this user: paid, in-flight (unexpired) and pending manual all count; refunded/failed/rejected do not
      const [a, b] = await Promise.all([Payment.countDocuments({ userId: user._id, discountId: discount._id, $or: [{ status: { $in: ['PAID', 'REFUNDING'] } }, { status: 'INITIATED', expiresAt: { $gt: new Date() } }] }), ManualPayment.countDocuments({ userId: user._id, discountId: discount._id, status: { $in: ['PENDING', 'APPROVED'] } })]);
      used = a + b;
    }
  }
  const price = pricing.applyDiscount(plan, discount, { userRedemptions: used });
  await subs.assertPurchasable(user, plan, price.finalPriceMinor);
  return { plan, discount, price };
}

async function startCheckout(user, body) {
  const { plan, discount, price } = await quote(user, body);
  if (price.finalPriceMinor === 0) { // price 0 (or 100% discount): no payment step
    const n = await Subscription.countDocuments({ userId: user._id, planId: plan._id, paymentMethod: 'FREE' });
    const sub = await subs.activate({ userId: user._id, plan, paymentKey: `free:${user._id}:${plan._id}:${n}`, method: 'FREE', price, discountId: discount && discount._id });
    if (sub.justCreated && discount) { try { await reserveDiscount(discount); } catch (e) { await Subscription.updateOne({ _id: sub._id }, { status: 'CANCELLED', revokedAt: new Date(), revokedReason: 'discount limit reached' }); throw e; } } // lost the last-use race: undo
    return { activated: true, subscription: sub };
  }
  const g = await gatewayState();
  if (body.method === 'SSLCOMMERZ') {
    if (!g.sslcommerz) throw bad('Card/online payment is not available right now', 'METHOD_DISABLED');
    const open = await Payment.findOne({ userId: user._id, planId: plan._id, status: 'INITIATED', expiresAt: { $gt: new Date() }, amountMinor: price.finalPriceMinor, discountId: discount ? discount._id : { $in: [null, undefined] } });
    if (open && open.gatewayUrl) return { redirectUrl: open.gatewayUrl, orderId: open.orderId }; // double click: same session, no second reservation
    await reserveDiscount(discount);
    const tranId = `MTP${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    let p; try { p = await createWithOrder(Payment, { userId: user._id, planId: plan._id, discountId: discount && discount._id, tranId, amountMinor: price.finalPriceMinor, currency: price.currency, originalPriceMinor: price.originalPriceMinor, discountMinor: price.discountMinor, expiresAt: new Date(Date.now() + 30 * 60000) }); } catch (e) { await unreserve(discount && discount._id); throw e; }
    try { const url = await ssl.initSession({ tranId, amountMinor: p.amountMinor, currency: p.currency, user, planName: plan.name }); await Payment.updateOne({ _id: p._id }, { gatewayUrl: url }); return { redirectUrl: url, orderId: p.orderId }; }
    catch (e) { await Payment.updateOne({ _id: p._id }, { status: 'FAILED' }); await releaseDiscount(Payment, p); throw bad('Could not start the payment. Please try again.', 'GATEWAY_ERROR'); }
  }
  if (body.method === 'MFS') {
    if (!g.mfs) throw bad('Manual payment is not available right now', 'METHOD_DISABLED');
    const prov = await MFSProvider.findOne({ _id: body.providerId, enabled: true }); if (!prov) throw bad('Choose a payment method');
    return { manual: true, amountMinor: price.finalPriceMinor, currency: price.currency, provider: { id: prov._id, name: prov.name, accountNumber: prov.accountNumber, accountType: prov.accountType, instructions: prov.instructions } };
  }
  throw bad('Choose a payment method');
}

// ---- SSLCommerz completion: shared by success redirect and IPN, so both are safe to repeat ----
async function completeSsl({ tranId, valId }) {
  const p = await Payment.findOne({ tranId }); if (!p) return { ok: false, reason: 'unknown transaction' };
  await Payment.updateOne({ _id: p._id }, { $inc: { callbackCount: 1 } });
  if (['PAID', 'REFUNDING', 'REFUNDED'].includes(p.status)) return p.status === 'PAID' ? finishPaid(p) : { ok: true }; // duplicate callback: repair a half-done activation, otherwise no-op
  if (['FAILED', 'CANCELLED'].includes(p.status)) return { ok: false, reason: p.status };
  if (!valId) return { ok: false, reason: 'missing val_id' };
  let v; try { v = await ssl.validate(valId); } catch { return { ok: false, reason: 'gateway unreachable', retry: true }; }
  const problem = ssl.checkValidation(v, p);
  if (problem) { const f = await Payment.findOneAndUpdate({ _id: p._id, status: 'INITIATED' }, { status: 'FAILED', gatewayStatus: v && v.status, validation: { problem } }); if (f) await releaseDiscount(Payment, f); return { ok: false, reason: problem }; }
  const won = await Payment.findOneAndUpdate({ _id: p._id, status: 'INITIATED' }, { status: 'PAID', paidAt: new Date(), valId, bankTranId: v.bank_tran_id, gatewayStatus: v.status, validation: v }, { new: true }); // atomic: exactly one caller wins
  return finishPaid(won || await Payment.findById(p._id));
}
async function finishPaid(p) {
  if (p.status !== 'PAID') return { ok: true };
  let sub = null;
  if (!p.subscriptionId) {
    const plan = await SubscriptionPlan.findById(p.planId);
    sub = await subs.activate({ userId: p.userId, plan, paymentKey: `ssl:${p.tranId}`, method: 'SSLCOMMERZ', discountId: p.discountId, orderId: p.orderId, price: { originalPriceMinor: p.originalPriceMinor, discountMinor: p.discountMinor, finalPriceMinor: p.amountMinor, currency: p.currency } }); // the charged price is honoured even if the plan was edited mid-checkout
    await Payment.updateOne({ _id: p._id }, { subscriptionId: sub._id });
  } else sub = await Subscription.findById(p.subscriptionId);
  await email.safe(notify.sslPaid(p, sub)); // idempotent keys inside: a repeated callback never double-sends
  return { ok: true };
}
async function markSslOutcome(tranId, status) { const p = await Payment.findOneAndUpdate({ tranId, status: 'INITIATED' }, { status }); if (p) await releaseDiscount(Payment, p); }
async function expireStalePayments() { // 24h grace so a delayed IPN can still complete; then the discount use goes back
  const stale = await Payment.find({ status: 'INITIATED', expiresAt: { $lte: new Date(Date.now() - 24 * 3600e3) } });
  for (const p of stale) { if (await Payment.findOneAndUpdate({ _id: p._id, status: 'INITIATED' }, { status: 'EXPIRED' })) await releaseDiscount(Payment, p); }
}

// ---- Manual MFS ----
async function submitManual(user, b) {
  const { plan, discount, price } = await quote(user, b);
  const g = await gatewayState(); if (!g.mfs) throw bad('Manual payment is not available right now', 'METHOD_DISABLED');
  const prov = await MFSProvider.findOne({ _id: b.providerId, enabled: true }); if (!prov) throw bad('Choose a payment method');
  const transactionId = b.transactionId.trim().toUpperCase();
  await reserveDiscount(discount);
  let mp;
  try {
    mp = await createWithOrder(ManualPayment, { userId: user._id, planId: plan._id, providerId: prov._id, discountId: discount && discount._id, transactionId, senderNumber: b.senderNumber, amountMinor: Math.round(b.amount * 100), expectedMinor: price.finalPriceMinor, currency: price.currency, originalPriceMinor: price.originalPriceMinor, discountMinor: price.discountMinor, note: b.note });
  } catch (e) { await unreserve(discount && discount._id); if (e.code === 11000) throw conflict('This transaction ID was already submitted', 'DUPLICATE_TRANSACTION'); throw e; }
  await email.safe(notify.manualSubmitted(mp)); // admins + the customer ("under review"); mail is sent in the background
  return mp;
}
async function reviewManual(id, admin, { approve, note }) {
  const mp = await ManualPayment.findById(id); if (!mp) throw missing('Payment not found');
  const won = await ManualPayment.findOneAndUpdate({ _id: id, status: 'PENDING' }, { status: approve ? 'APPROVED' : 'REJECTED', reviewedAt: new Date(), reviewedBy: admin._id, adminNote: note }, { new: true }); // exactly one reviewer wins
  if (!won) throw conflict(`Already ${mp.status.toLowerCase()}`, 'ALREADY_REVIEWED');
  if (approve) {
    if (won.amountMinor !== won.expectedMinor) await ManualPayment.updateOne({ _id: id }, { adminNote: `${note || ''} [amount differs: paid ${won.amountMinor}, expected ${won.expectedMinor}]`.trim() });
    const plan = await SubscriptionPlan.findById(won.planId);
    const sub = await subs.activate({ userId: won.userId, plan, paymentKey: `mfs:${won._id}`, method: 'MFS', discountId: won.discountId, orderId: won.orderId, price: { originalPriceMinor: won.originalPriceMinor, discountMinor: won.discountMinor, finalPriceMinor: won.expectedMinor, currency: won.currency } });
    await ManualPayment.updateOne({ _id: id }, { subscriptionId: sub._id });
    await email.safe(notify.manualApproved(won, sub)); // memo + PDF, queued: the approval never waits for a mail server
  } else { await releaseDiscount(ManualPayment, won); await email.safe(notify.manualRejected(won, note)); }
  return ManualPayment.findById(id);
}
module.exports = { gatewayState, quote, startCheckout, completeSsl, markSslOutcome, expireStalePayments, submitManual, reviewManual, releaseDiscount, reserveDiscount };
