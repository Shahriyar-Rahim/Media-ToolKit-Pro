// Runs only when MONGODB_TEST_URI points at a THROWAWAY database (it is wiped). Example:
//   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/mtp_test npm test
process.env.NODE_ENV = 'test';
const URI = process.env.MONGODB_TEST_URI;
const test = require('node:test');
const assert = require('node:assert');
const skip = !URI && 'set MONGODB_TEST_URI to run DB integration tests';
const mongoose = require('mongoose');
const M = require('../src/models');
const email = require('../src/services/email');
const ssl = require('../src/services/sslcommerz');
const auth = require('../src/services/auth');
const checkout = require('../src/services/checkout');
const subs = require('../src/services/subscriptions');
const usage = require('../src/services/usage');
const settings = require('../src/services/settings');
const refunds = require('../src/services/refunds');
const reauth = require('../src/services/reauth');

const sent = []; const realSend = email.send;
email.send = async (tpl, to, data) => { sent.push({ tpl, to, data }); };
const lastCode = (to) => [...sent].reverse().find((m) => m.to === to && m.data.code).data.code;
const count = (tpl) => sent.filter((m) => m.tpl === tpl).length;
let n = 0; const mail = () => `user${++n}@example.com`;
const PW = 'correct-horse-9';

async function verifiedUser() {
  const e = mail(); await auth.register({ email: e, password: PW, name: 'T' }); await auth.verifyEmail(e, lastCode(e)); return M.User.findOne({ email: e });
}
const mkPlan = (o = {}) => M.SubscriptionPlan.create({ name: 'P', slug: `p${++n}`, priceMinor: 50000, billingPeriodDays: 30, rank: 1, entitlements: { features: { videoCompression: true }, limits: {} }, ...o });
const sslPayment = async (u, plan, over = {}) => M.Payment.create({ userId: u._id, planId: plan._id, tranId: `T${++n}`, amountMinor: plan.priceMinor, currency: 'BDT', originalPriceMinor: plan.priceMinor, discountMinor: 0, expiresAt: new Date(Date.now() + 1e6), ...over });
const okValidation = (p) => async () => ({ status: 'VALID', tran_id: p.tranId, currency_type: p.currency, amount: (p.amountMinor / 100).toFixed(2), bank_tran_id: 'B1' });

test.before(async () => { if (!URI) return; await mongoose.connect(URI); await mongoose.connection.dropDatabase(); await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes())); });
test.beforeEach(() => settings.clear());
test.after(async () => { email.send = realSend; if (URI) await mongoose.disconnect(); });

test('AUTH register, duplicate email, verify, login', { skip }, async () => {
  const e = mail(); await auth.register({ email: e, password: PW }); await auth.register({ email: e, password: PW });
  assert.strictEqual(await M.User.countDocuments({ email: e }), 1);
  await assert.rejects(auth.login({ email: e, password: PW }), (x) => x.code === 'EMAIL_NOT_VERIFIED');
  await assert.rejects(auth.verifyEmail(e, '000000'), (x) => x.code === 'OTP_WRONG');
  await settings.set('security', { ...(await settings.get('security')), otpResendSeconds: 10 }); // valid code below still works
  await auth.verifyEmail(e, lastCode(e)); const r = await auth.login({ email: e, password: PW }); assert.ok(r.user);
  assert.ok((await M.User.findOne({ email: e })).freeTrialStartedAt);
});
test('AUTH wrong password, unknown email look identical; lockout after repeated failures', { skip }, async () => {
  const u = await verifiedUser(); await settings.set('security', { ...(await settings.get('security')), maxFailedLogins: 3 });
  const msg = async (p) => p.catch((x) => x.message);
  assert.strictEqual(await msg(auth.login({ email: 'ghost@example.com', password: PW })), await msg(auth.login({ email: u.email, password: 'wrong-pass-1' })));
  await msg(auth.login({ email: u.email, password: 'wrong-pass-1' })); await msg(auth.login({ email: u.email, password: 'wrong-pass-1' }));
  await assert.rejects(auth.login({ email: u.email, password: PW }), /Invalid email or password/); // locked even with the right password
});
test('AUTH OTP: single-use, attempt limit, expiry, resend cooldown', { skip }, async () => {
  const u = await verifiedUser(); await settings.set('security', { ...(await settings.get('security')), otpResendSeconds: 0, otpMaxAttempts: 3 });
  await auth.issueOtp(u, 'LOGIN'); const c = lastCode(u.email); await auth.consumeOtp(u, 'LOGIN', c);
  await assert.rejects(auth.consumeOtp(u, 'LOGIN', c), (x) => x.code === 'OTP_INVALID'); // reuse
  await auth.issueOtp(u, 'LOGIN'); const c2 = lastCode(u.email);
  for (let i = 0; i < 3; i++) await auth.consumeOtp(u, 'LOGIN', '999999').catch(() => {});
  await assert.rejects(auth.consumeOtp(u, 'LOGIN', c2), (x) => x.code === 'OTP_LOCKED'); // even the right code after too many tries
  await auth.issueOtp(u, 'LOGIN'); await M.Otp.updateMany({ userId: u._id, consumedAt: null }, { expiresAt: new Date(Date.now() - 1000) });
  await assert.rejects(auth.consumeOtp(u, 'LOGIN', lastCode(u.email)), (x) => x.code === 'OTP_EXPIRED');
  await settings.set('security', { ...(await settings.get('security')), otpResendSeconds: 60 }); await auth.issueOtp(u, 'RESET_PASSWORD');
  await assert.rejects(auth.issueOtp(u, 'RESET_PASSWORD'), (x) => x.code === 'OTP_COOLDOWN');
});
test('AUTH password reset revokes sessions and changes password', { skip }, async () => {
  const u = await verifiedUser(); await settings.set('security', { ...(await settings.get('security')), otpResendSeconds: 0 });
  const s = await auth.startSession(u); await auth.forgotPassword(u.email); await auth.resetPassword(u.email, lastCode(u.email), 'brand-new-pass-7');
  await assert.rejects(auth.refresh(s.refresh)); assert.ok((await auth.login({ email: u.email, password: 'brand-new-pass-7' })).user);
});
test('AUTH refresh token rotates and old token cannot be replayed', { skip }, async () => {
  const u = await verifiedUser(); const s = await auth.startSession(u); const s2 = await auth.refresh(s.refresh); assert.ok(s2.refresh !== s.refresh); await assert.rejects(auth.refresh(s.refresh));
});

test('SUBSCRIPTION price 0 plan activates without payment; lifetime has no end date', { skip }, async () => {
  const u = await verifiedUser(); const free = await mkPlan({ priceMinor: 0, name: 'Free' });
  const r = await checkout.startCheckout(u, { planId: String(free._id) }); assert.ok(r.activated); assert.strictEqual(r.subscription.finalPriceMinor, 0);
  const life = await mkPlan({ isLifetime: true, billingPeriodDays: undefined, rank: 5 }); const s = await subs.activate({ userId: u._id, plan: life, paymentKey: `t:${++n}`, method: 'ADMIN_GRANT', price: { originalPriceMinor: 0, discountMinor: 0, finalPriceMinor: 0, currency: 'BDT' } });
  assert.strictEqual(s.endsAt, null); assert.ok(s.isLifetime);
  await assert.rejects(checkout.startCheckout(u, { planId: String(life._id), method: 'SSLCOMMERZ' }), (x) => x.code === 'ALREADY_ENTITLED');
});
test('SUBSCRIPTION same-plan renewal stacks time; plan edits/archival do not rewrite history', { skip }, async () => {
  const u = await verifiedUser(); const p = await mkPlan(); const price = { originalPriceMinor: 1, discountMinor: 0, finalPriceMinor: 1, currency: 'BDT' };
  const a = await subs.activate({ userId: u._id, plan: p, paymentKey: `t:${++n}`, method: 'SSLCOMMERZ', price }); const b = await subs.activate({ userId: u._id, plan: p, paymentKey: `t:${++n}`, method: 'SSLCOMMERZ', price });
  assert.ok(b.endsAt - a.endsAt >= 29 * 864e5);
  await M.SubscriptionPlan.updateOne({ _id: p._id }, { active: false, archivedAt: new Date(), priceMinor: 999999, 'entitlements.features.videoCompression': false });
  const e = await usage.current(u); assert.ok(e.features.videoCompression); assert.strictEqual(e.source, 'SUBSCRIPTION'); // still honoured from the purchase snapshot
  await assert.rejects(checkout.startCheckout(u, { planId: String(p._id), method: 'SSLCOMMERZ' }), (x) => x.code === 'PLAN_UNAVAILABLE');
});
test('SUBSCRIPTION expired subscription stops granting access; revoke works', { skip }, async () => {
  const u = await verifiedUser(); const p = await mkPlan(); const s = await subs.activate({ userId: u._id, plan: p, paymentKey: `t:${++n}`, method: 'FREE', price: { originalPriceMinor: 0, discountMinor: 0, finalPriceMinor: 0, currency: 'BDT' } });
  await M.Subscription.updateOne({ _id: s._id }, { endsAt: new Date(Date.now() - 1000) }); assert.notStrictEqual((await usage.current(u)).source, 'SUBSCRIPTION');
  const s2 = await subs.activate({ userId: u._id, plan: p, paymentKey: `t:${++n}`, method: 'FREE', price: { originalPriceMinor: 0, discountMinor: 0, finalPriceMinor: 0, currency: 'BDT' } });
  await subs.revoke(s2._id, 'test'); assert.notStrictEqual((await usage.current(u)).source, 'SUBSCRIPTION');
});
test('USAGE consume is idempotent per clientJobId and enforces free-trial count', { skip }, async () => {
  const u = await verifiedUser(); await settings.set('freeAccess', { enabled: true, trialDays: 7, operationCount: 2, dailyLimit: null, monthlyLimit: null, allowedFeatures: ['videoCompression'], maxFileSizeMB: null });
  await usage.consume(u, { feature: 'videoCompression', clientJobId: 'job-00000001' }); await usage.consume(u, { feature: 'videoCompression', clientJobId: 'job-00000001' });
  assert.strictEqual(await M.UsageRecord.countDocuments({ userId: u._id }), 1); await usage.consume(u, { feature: 'videoCompression', clientJobId: 'job-00000002' });
  await assert.rejects(usage.consume(u, { feature: 'videoCompression', clientJobId: 'job-00000003' }), (x) => x.code === 'ENTITLEMENT_DENIED');
  await assert.rejects(usage.consume(u, { feature: 'pdfMerge', clientJobId: 'job-00000004' }), (x) => x.code === 'ENTITLEMENT_DENIED');
});

test('PAYMENT SSLCommerz success activates once; replayed callback and IPN change nothing', { skip }, async () => {
  const u = await verifiedUser(); const p = await mkPlan(); const pay = await sslPayment(u, p); ssl.validate = okValidation(pay);
  const before = count('paymentReceived');
  const results = await Promise.all([1, 2, 3].map(() => checkout.completeSsl({ tranId: pay.tranId, valId: 'V1' }))); // concurrent duplicates
  await checkout.completeSsl({ tranId: pay.tranId, valId: 'V1' });
  assert.ok(results.every((r) => r.ok)); assert.strictEqual(await M.Subscription.countDocuments({ userId: u._id }), 1);
  assert.strictEqual((await M.Payment.findById(pay._id)).status, 'PAID'); assert.strictEqual(count('paymentReceived') - before, 1);
});
test('PAYMENT amount mismatch, currency mismatch and failed gateway status never activate', { skip }, async () => {
  const u = await verifiedUser(); const p = await mkPlan();
  for (const bad of [{ amount: '1.00' }, { currency_type: 'USD' }, { status: 'FAILED' }]) {
    const pay = await sslPayment(u, p); ssl.validate = async () => ({ status: 'VALID', tran_id: pay.tranId, currency_type: 'BDT', amount: '500.00', ...bad });
    assert.strictEqual((await checkout.completeSsl({ tranId: pay.tranId, valId: 'V' })).ok, false); assert.strictEqual((await M.Payment.findById(pay._id)).status, 'FAILED');
  }
  assert.strictEqual(await M.Subscription.countDocuments({ userId: u._id }), 0);
});
test('PAYMENT unknown transaction, cancel/fail outcomes and crash-repair', { skip }, async () => {
  assert.strictEqual((await checkout.completeSsl({ tranId: 'NOPE', valId: 'V' })).ok, false);
  const u = await verifiedUser(); const p = await mkPlan(); const c = await sslPayment(u, p); await checkout.markSslOutcome(c.tranId, 'CANCELLED'); assert.strictEqual((await checkout.completeSsl({ tranId: c.tranId, valId: 'V' })).ok, false);
  const half = await sslPayment(u, p, { status: 'PAID', paidAt: new Date() }); // simulate crash after PAID, before activation
  assert.ok((await checkout.completeSsl({ tranId: half.tranId })).ok); assert.strictEqual(await M.Subscription.countDocuments({ paymentKey: `ssl:${half.tranId}` }), 1);
  const late = await sslPayment(u, p); ssl.validate = async () => { throw new Error('down'); }; const r = await checkout.completeSsl({ tranId: late.tranId, valId: 'V' }); assert.ok(r.retry); assert.strictEqual((await M.Payment.findById(late._id)).status, 'INITIATED'); // delayed: stays open for retry
});
test('PAYMENT discount is applied server-side and counted once on success', { skip }, async () => {
  const u = await verifiedUser(); const p = await mkPlan(); const d = await M.Discount.create({ code: `SAVE${++n}`, type: 'PERCENT', value: 50, maxRedemptions: 2, redeemedCount: 1 }); // 1 = this checkout's reservation
  const q = await checkout.quote(u, { planId: String(p._id), discountCode: d.code.toLowerCase() }); assert.strictEqual(q.price.finalPriceMinor, 25000);
  const pay = await sslPayment(u, p, { amountMinor: 25000, discountId: d._id, discountMinor: 25000 }); ssl.validate = okValidation(pay);
  await checkout.completeSsl({ tranId: pay.tranId, valId: 'V' }); await checkout.completeSsl({ tranId: pay.tranId, valId: 'V' });
  assert.strictEqual((await M.Discount.findById(d._id)).redeemedCount, 1); // success does not count again
  await M.Discount.updateOne({ _id: d._id }, { redeemedCount: 2 });
  await assert.rejects(checkout.quote(await verifiedUser(), { planId: String(p._id), discountCode: d.code }), /limit reached/);
});
test('GATEWAYS admin toggles decide what users can use; both off gives the fallback message', { skip }, async () => {
  await M.PaymentGatewayConfig.deleteMany({}); await M.MFSProvider.deleteMany({}); ssl.configured = () => true;
  let g = await checkout.gatewayState(); assert.strictEqual(g.sslcommerz, false); assert.match(g.message, /temporarily unavailable/);
  await M.PaymentGatewayConfig.create({ key: 'SSLCOMMERZ', enabled: true }); g = await checkout.gatewayState(); assert.ok(g.sslcommerz && !g.mfs);
  await M.MFSProvider.create({ name: 'bKash', accountNumber: '01711111111' }); await M.PaymentGatewayConfig.create({ key: 'MFS', enabled: true }); g = await checkout.gatewayState(); assert.ok(g.sslcommerz && g.mfs);
  await M.PaymentGatewayConfig.updateOne({ key: 'SSLCOMMERZ' }, { enabled: false }); g = await checkout.gatewayState(); assert.ok(!g.sslcommerz && g.mfs);
  const u = await verifiedUser(); const p = await mkPlan(); await assert.rejects(checkout.startCheckout(u, { planId: String(p._id), method: 'SSLCOMMERZ' }), (x) => x.code === 'METHOD_DISABLED');
});
test('MFS submit, duplicate txn id, approve once, reject, never auto-activates', { skip }, async () => {
  await M.MFSProvider.deleteMany({}); await M.PaymentGatewayConfig.updateOne({ key: 'MFS' }, { enabled: true }, { upsert: true });
  const prov = await M.MFSProvider.create({ name: 'Nagad', accountNumber: '01822222222' }); const u = await verifiedUser(); const p = await mkPlan(); const admin = await verifiedUser();
  const body = { planId: String(p._id), providerId: String(prov._id), transactionId: 'abc12345', senderNumber: '01700000000', amount: 500 };
  const mp = await checkout.submitManual(u, body); assert.strictEqual(mp.status, 'PENDING'); assert.strictEqual(await M.Subscription.countDocuments({ userId: u._id }), 0);
  await assert.rejects(checkout.submitManual(await verifiedUser(), { ...body, transactionId: 'ABC12345' }), (x) => x.code === 'DUPLICATE_TRANSACTION');
  await Promise.all([checkout.reviewManual(mp._id, admin, { approve: true }), checkout.reviewManual(mp._id, admin, { approve: true })].map((p2) => p2.catch(() => null)));
  assert.strictEqual(await M.Subscription.countDocuments({ userId: u._id }), 1); assert.strictEqual(count('paymentApproved') >= 1, true);
  await assert.rejects(checkout.reviewManual(mp._id, admin, { approve: false }), (x) => x.code === 'ALREADY_REVIEWED');
  const mp2 = await checkout.submitManual(u, { ...body, transactionId: 'zzz99999' }); await checkout.reviewManual(mp2._id, admin, { approve: false, note: 'no funds' });
  assert.strictEqual((await M.ManualPayment.findById(mp2._id)).status, 'REJECTED'); assert.strictEqual(await M.Subscription.countDocuments({ userId: u._id }), 1);
});

// ------------------------- refunds -------------------------
const paidSsl = async (u, plan, over = {}) => { const pay = await sslPayment(u, plan, over); ssl.validate = async () => ({ status: 'VALID', tran_id: pay.tranId, currency_type: 'BDT', amount: (pay.amountMinor / 100).toFixed(2), bank_tran_id: 'BANK1' }); await checkout.completeSsl({ tranId: pay.tranId, valId: 'V' }); return M.Payment.findById(pay._id); };
test('REFUND via gateway ends access, restores the discount, emails once and cannot repeat', { skip }, async () => {
  const u = await verifiedUser(); const admin = await verifiedUser(); const p = await mkPlan(); const d = await M.Discount.create({ code: `RF${++n}`, type: 'PERCENT', value: 10, maxRedemptions: 5, redeemedCount: 1 });
  const pay = await paidSsl(u, p, { discountId: d._id }); assert.strictEqual((await usage.current(u)).source, 'SUBSCRIPTION');
  ssl.configured = () => true; let calls = 0; ssl.refund = async () => { calls++; return { status: 'success', refund_ref_id: 'R1' }; };
  const before = count('refundProcessed'); const r = await refunds.refundSsl(pay._id, admin, { reason: 'customer request', viaGateway: true });
  assert.strictEqual(r.status, 'REFUNDED'); assert.strictEqual(r.refundGatewayStatus, 'SUCCESS'); assert.strictEqual(calls, 1);
  assert.strictEqual((await M.Subscription.findById(pay.subscriptionId)).status, 'REFUNDED'); assert.notStrictEqual((await usage.current(u)).source, 'SUBSCRIPTION');
  assert.strictEqual((await M.Discount.findById(d._id)).redeemedCount, 0); assert.strictEqual(count('refundProcessed') - before, 1);
  await assert.rejects(refunds.refundSsl(pay._id, admin, { reason: 'again', viaGateway: true }), (x) => x.code === 'ALREADY_REFUNDED'); assert.strictEqual(calls, 1);
});
test('REFUND two admins at once sends exactly one gateway refund', { skip }, async () => {
  const u = await verifiedUser(); const a1 = await verifiedUser(); const a2 = await verifiedUser(); const pay = await paidSsl(u, await mkPlan());
  ssl.configured = () => true; let calls = 0; ssl.refund = async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { status: 'success' }; };
  const res = await Promise.allSettled([refunds.refundSsl(pay._id, a1, { reason: 'dup test', viaGateway: true }), refunds.refundSsl(pay._id, a2, { reason: 'dup test', viaGateway: true })]);
  assert.strictEqual(calls, 1); assert.strictEqual(res.filter((r) => r.status === 'fulfilled').length, 1); assert.strictEqual((await M.Payment.findById(pay._id)).status, 'REFUNDED');
});
test('REFUND gateway refusal leaves the payment PAID and access intact', { skip }, async () => {
  const u = await verifiedUser(); const admin = await verifiedUser(); const pay = await paidSsl(u, await mkPlan());
  ssl.configured = () => true; ssl.refund = async () => ({ status: 'failed', errorReason: 'insufficient balance' });
  await assert.rejects(refunds.refundSsl(pay._id, admin, { reason: 'test', viaGateway: true }), (x) => x.code === 'GATEWAY_REFUSED');
  const after = await M.Payment.findById(pay._id); assert.strictEqual(after.status, 'PAID'); assert.strictEqual((await usage.current(u)).source, 'SUBSCRIPTION');
});
test('REFUND unreachable gateway stays REFUNDING; the retry checks the gateway first and never double-sends', { skip }, async () => {
  const u = await verifiedUser(); const admin = await verifiedUser(); const pay = await paidSsl(u, await mkPlan());
  ssl.configured = () => true; let sends = 0; ssl.refund = async () => { sends++; throw new Error('timeout'); };
  await assert.rejects(refunds.refundSsl(pay._id, admin, { reason: 'test', viaGateway: true }), (x) => x.code === 'GATEWAY_UNREACHABLE');
  assert.strictEqual((await M.Payment.findById(pay._id)).status, 'REFUNDING'); assert.strictEqual((await usage.current(u)).source, 'SUBSCRIPTION'); // unknown outcome: access kept until confirmed
  await M.Payment.updateOne({ _id: pay._id }, { refundLockUntil: new Date(Date.now() - 1000) }); ssl.refundStatus = async () => ({ status: 'processing' });
  const r = await refunds.refundSsl(pay._id, admin, { reason: 'test', viaGateway: true }); assert.strictEqual(r.status, 'REFUNDED'); assert.strictEqual(r.refundGatewayStatus, 'PROCESSING'); assert.strictEqual(sends, 1);
});
test('REFUND without gateway credentials or bank id is refused cleanly; "already refunded outside" works', { skip }, async () => {
  const u = await verifiedUser(); const admin = await verifiedUser(); const pay = await paidSsl(u, await mkPlan());
  ssl.configured = () => false; await assert.rejects(refunds.refundSsl(pay._id, admin, { reason: 'test', viaGateway: true }), (x) => x.code === 'GATEWAY_NOT_CONFIGURED'); assert.strictEqual((await M.Payment.findById(pay._id)).status, 'PAID');
  await M.Payment.updateOne({ _id: pay._id }, { bankTranId: null }); ssl.configured = () => true; await assert.rejects(refunds.refundSsl(pay._id, admin, { reason: 'test', viaGateway: true }), (x) => x.code === 'NO_BANK_TRAN_ID');
  const r = await refunds.refundSsl(pay._id, admin, { reason: 'sent from the SSLCommerz panel', viaGateway: false }); assert.strictEqual(r.refundGatewayStatus, 'MANUAL'); assert.strictEqual(r.status, 'REFUNDED');
});
test('REFUND only paid payments can be refunded', { skip }, async () => {
  const u = await verifiedUser(); const admin = await verifiedUser(); const open = await sslPayment(u, await mkPlan());
  await assert.rejects(refunds.refundSsl(open._id, admin, { reason: 'test', viaGateway: false }), (x) => x.code === 'NOT_REFUNDABLE');
});
test('REFUND manual MFS payment: approved only, ends access, once', { skip }, async () => {
  await M.MFSProvider.deleteMany({}); await M.PaymentGatewayConfig.updateOne({ key: 'MFS' }, { enabled: true }, { upsert: true });
  const prov = await M.MFSProvider.create({ name: 'Rocket', accountNumber: '01933333333' }); const u = await verifiedUser(); const admin = await verifiedUser(); const p = await mkPlan();
  const mp = await checkout.submitManual(u, { planId: String(p._id), providerId: String(prov._id), transactionId: `rf${++n}abcd`, senderNumber: '01700000001', amount: 500 });
  await assert.rejects(refunds.refundManual(mp._id, admin, { reason: 'too early' }), (x) => x.code === 'NOT_REFUNDABLE');
  await checkout.reviewManual(mp._id, admin, { approve: true }); const r = await refunds.refundManual(mp._id, admin, { reason: 'sent back via Rocket' });
  assert.strictEqual(r.status, 'REFUNDED'); assert.notStrictEqual((await usage.current(u)).source, 'SUBSCRIPTION'); await assert.rejects(refunds.refundManual(mp._id, admin, { reason: 'again' }), (x) => x.code === 'ALREADY_REFUNDED');
});

// ------------------------- discount cap, reauth, access reset, abuse -------------------------
test('DISCOUNT last use cannot be taken twice; failed checkouts give the use back exactly once', { skip }, async () => {
  await M.PaymentGatewayConfig.updateOne({ key: 'SSLCOMMERZ' }, { enabled: true }, { upsert: true }); ssl.configured = () => true; ssl.initSession = async () => 'https://sandbox.sslcommerz.com/pay';
  const p = await mkPlan(); const d = await M.Discount.create({ code: `LAST${++n}`, type: 'PERCENT', value: 20, maxRedemptions: 1 }); const a = await verifiedUser(); const b = await verifiedUser();
  const r = await Promise.allSettled([a, b].map((u) => checkout.startCheckout(u, { planId: String(p._id), discountCode: d.code, method: 'SSLCOMMERZ' })));
  assert.strictEqual(r.filter((x) => x.status === 'fulfilled').length, 1); assert.strictEqual((await M.Discount.findById(d._id)).redeemedCount, 1);
  const open = await M.Payment.findOne({ discountId: d._id }); await checkout.markSslOutcome(open.tranId, 'CANCELLED'); await checkout.markSslOutcome(open.tranId, 'FAILED');
  assert.strictEqual((await M.Discount.findById(d._id)).redeemedCount, 0); // released once, not twice
});
test('MFS rejection returns the discount use', { skip }, async () => {
  await M.MFSProvider.deleteMany({}); await M.PaymentGatewayConfig.updateOne({ key: 'MFS' }, { enabled: true }, { upsert: true });
  const prov = await M.MFSProvider.create({ name: 'Upay', accountNumber: '01844444444' }); const p = await mkPlan(); const d = await M.Discount.create({ code: `MF${++n}`, type: 'PERCENT', value: 10, maxRedemptions: 3 }); const u = await verifiedUser(); const admin = await verifiedUser();
  const mp = await checkout.submitManual(u, { planId: String(p._id), providerId: String(prov._id), discountCode: d.code, transactionId: `mf${++n}abcd`, senderNumber: '01700000002', amount: 450 }); assert.strictEqual((await M.Discount.findById(d._id)).redeemedCount, 1);
  await checkout.reviewManual(mp._id, admin, { approve: false }); assert.strictEqual((await M.Discount.findById(d._id)).redeemedCount, 0);
});
test('REAUTH emailed code unlocks sensitive actions for the window; wrong code does not', { skip }, async () => {
  const u = await verifiedUser(); await settings.set('security', { ...(await settings.get('security')), otpResendSeconds: 0 });
  const run = (user) => new Promise((resolve) => reauth.required({ user }, {}, (e) => resolve(e)));
  assert.strictEqual((await run(u)).code, 'REAUTH_REQUIRED'); await reauth.request(u); await assert.rejects(reauth.confirm(u, '000000'), (x) => x.code === 'OTP_WRONG');
  await reauth.confirm(u, lastCode(u.email)); assert.strictEqual(await run(await M.User.findById(u._id)), undefined);
});
test('ACCESS RESET clears lockout and sessions; forced reset blocks login until the password is changed', { skip }, async () => {
  const u = await verifiedUser(); const s = await auth.startSession(u); await M.User.updateOne({ _id: u._id }, { failedLogins: 5, lockUntil: new Date(Date.now() + 1e6), sessions: [], mustResetPassword: true });
  await settings.set('security', { ...(await settings.get('security')), otpResendSeconds: 0 });
  await M.User.updateOne({ _id: u._id }, { lockUntil: null }); await assert.rejects(auth.login({ email: u.email, password: PW }), (x) => x.code === 'PASSWORD_RESET_REQUIRED');
  await auth.resetPassword(u.email, lastCode(u.email), 'fresh-password-33'); assert.ok((await auth.login({ email: u.email, password: 'fresh-password-33' })).user); await assert.rejects(auth.refresh(s.refresh));
});
test('ABUSE gmail aliases of one inbox cannot register twice; blocked email domains are refused', { skip }, async () => {
  const base = `abuse${++n}`; await auth.register({ email: `${base}.x@gmail.com`, password: PW }); await auth.register({ email: `${base}x+2@gmail.com`, password: PW });
  assert.strictEqual(await M.User.countDocuments({ emailCanonical: `${base}x@gmail.com` }), 1);
  await settings.set('security', { ...(await settings.get('security')), blockedEmailDomains: ['throwaway.test'] }); await assert.rejects(auth.register({ email: 'x@throwaway.test', password: PW }), (x) => x.code === 'EMAIL_DOMAIN_BLOCKED');
});
