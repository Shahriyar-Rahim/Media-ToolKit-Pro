process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync } = require('crypto');
const pricing = require('../src/services/pricing');
const ent = require('../src/services/entitlement');
const otp = require('../src/services/otpCore');
const ssl = require('../src/services/sslcommerz');
const { S } = require('../src/validators/schemas');

const plan = (o = {}) => ({ _id: 'p1', priceMinor: 50000, currency: 'BDT', ...o });
const d = (o = {}) => ({ enabled: true, type: 'PERCENT', value: 20, redeemedCount: 0, perUserLimit: 1, planIds: [], ...o });
const now = new Date('2026-06-15T00:00:00Z');

test('DISCOUNT valid percent and fixed', () => {
  assert.deepStrictEqual(pricing.applyDiscount(plan(), d(), {}).finalPriceMinor, 40000);
  assert.strictEqual(pricing.applyDiscount(plan(), d({ type: 'FIXED', value: 10000 }), {}).finalPriceMinor, 40000);
});
test('DISCOUNT never produces a negative price and 100% gives 0', () => {
  assert.strictEqual(pricing.computePrice(plan(), d({ type: 'FIXED', value: 999999 })).finalPriceMinor, 0);
  assert.strictEqual(pricing.computePrice(plan(), d({ value: 100 })).finalPriceMinor, 0);
});
test('DISCOUNT rejects expired, disabled, not-started, wrong plan, exhausted, per-user', () => {
  const t = (disc, ctx, re) => assert.throws(() => pricing.applyDiscount(plan(), disc, { now, ...ctx }), re);
  t(d({ endsAt: new Date('2026-01-01') }), {}, /expired/); t(d({ enabled: false }), {}, /disabled/); t(d({ startsAt: new Date('2027-01-01') }), {}, /not active/);
  t(d({ planIds: ['other'] }), {}, /does not apply/); t(d({ maxRedemptions: 5, redeemedCount: 5 }), {}, /limit/); t(d(), { userRedemptions: 1 }, /already used/);
});
test('PRICE 0 plan is valid', () => { assert.strictEqual(pricing.computePrice(plan({ priceMinor: 0 }), null).finalPriceMinor, 0); assert.ok(S.planBody.safeParse({ name: 'Free', slug: 'free', priceMinor: 0, billingPeriodDays: 30 }).success); });
test('PLAN lifetime needs no period; non-lifetime does; negative price rejected', () => {
  assert.ok(S.planBody.safeParse({ name: 'L', slug: 'l', priceMinor: 100, isLifetime: true }).success);
  assert.ok(!S.planBody.safeParse({ name: 'M', slug: 'm', priceMinor: 100 }).success);
  assert.ok(!S.planBody.safeParse({ name: 'M', slug: 'm', priceMinor: -1, billingPeriodDays: 30 }).success);
  assert.ok(!S.planBody.safeParse({ name: 'M', slug: 'm', priceMinor: 1.5, billingPeriodDays: 30 }).success);
});
test('DISCOUNT schema rejects invalid percentage', () => {
  assert.ok(!S.discountBody.safeParse({ code: 'ABC', type: 'PERCENT', value: 150 }).success);
  assert.ok(!S.discountBody.safeParse({ code: 'ABC', type: 'PERCENT', value: 0 }).success);
  assert.ok(S.discountBody.safeParse({ code: 'abc', type: 'PERCENT', value: 10 }).success);
});

const sub = (o) => ({ status: 'ACTIVE', isLifetime: false, endsAt: new Date('2026-07-15'), planSnapshot: { name: 'Basic', rank: 1, entitlements: { features: { videoCompression: true }, limits: { dailyJobs: 2 } } }, ...o });
const free = { enabled: true, trialDays: 7, operationCount: 3, dailyLimit: 5, monthlyLimit: 10, allowedFeatures: ['heicConversion'], maxFileSizeMB: 10 };
const u = (days) => ({ freeTrialStartedAt: new Date(now - days * 864e5) });
const usage = (o = {}) => ({ today: 0, month: 0, total: 0, ...o });

test('ENTITLEMENT no subscription and no trial = NONE', () => {
  const e = ent.resolve({ user: {}, subscriptions: [], free, usage: usage(), now }); assert.strictEqual(e.source, 'NONE'); assert.ok(!ent.authorize(e, 'heicConversion').ok);
});
test('ENTITLEMENT active subscription grants only its features and enforces daily limit', () => {
  const e = ent.resolve({ user: {}, subscriptions: [sub()], free, usage: usage(), now });
  assert.ok(ent.authorize(e, 'videoCompression').ok); assert.match(ent.authorize(e, 'pdfMerge').reason, /does not include/);
  const full = ent.resolve({ user: {}, subscriptions: [sub()], free, usage: usage({ today: 2 }), now }); assert.match(ent.authorize(full, 'videoCompression').reason, /Daily limit/);
});
test('ENTITLEMENT expired and revoked subscriptions do not count', () => {
  assert.strictEqual(ent.resolve({ user: {}, subscriptions: [sub({ endsAt: new Date('2026-06-01') })], free: { enabled: false }, usage: usage(), now }).source, 'NONE');
  assert.strictEqual(ent.resolve({ user: {}, subscriptions: [sub({ revokedAt: new Date() })], free: { enabled: false }, usage: usage(), now }).source, 'NONE');
  assert.strictEqual(ent.resolve({ user: {}, subscriptions: [sub({ status: 'PENDING' })], free: { enabled: false }, usage: usage(), now }).source, 'NONE');
});
test('ENTITLEMENT lifetime never expires and higher rank wins', () => {
  const life = sub({ isLifetime: true, endsAt: null, planSnapshot: { name: 'Life', rank: 3, entitlements: { features: { pdfMerge: true }, limits: {} } } });
  const e = ent.resolve({ user: {}, subscriptions: [sub(), life], free, usage: usage(), now: new Date('2099-01-01') }); assert.strictEqual(e.planName, 'Life'); assert.strictEqual(e.lifetime, true); assert.strictEqual(e.endsAt, null);
});
test('FREE trial: active, expires by days, exhausts by count, admin-disabled, feature range and size', () => {
  const r = (user, f, us) => ent.resolve({ user, subscriptions: [], free: f, usage: us || usage(), now });
  assert.strictEqual(r(u(2), free).source, 'FREE'); assert.strictEqual(r(u(8), free).source, 'NONE'); assert.ok(r(u(8), free).trialExpired);
  assert.strictEqual(r(u(2), free, usage({ total: 3 })).source, 'NONE'); assert.strictEqual(r(u(2), { ...free, enabled: false }).source, 'NONE');
  const e = r(u(2), free); assert.ok(ent.authorize(e, 'heicConversion').ok); assert.ok(!ent.authorize(e, 'videoCompression').ok); assert.match(ent.authorize(e, 'heicConversion', 11 * 1048576).reason, /larger/);
  assert.strictEqual(r({}, free).source, 'NONE'); // unverified user: trial never started
});
test('ENTITLEMENT signed offline snapshot verifies with public key and rejects tampering', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const env = require('../src/config/env'); env.entitlementPrivateKey = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const e = ent.resolve({ user: {}, subscriptions: [sub()], free, usage: usage(), now: new Date() });
  const tok = ent.signSnapshot('u1', { ...e, endsAt: new Date('2099-01-01') }); const pub = publicKey.export({ type: 'spki', format: 'pem' });
  assert.strictEqual(ent.verifySnapshot(tok, pub).sub, 'u1');
  const [h, p, s] = tok.split('.'); const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: 'u2' })).toString('base64url');
  assert.throws(() => ent.verifySnapshot(`${h}.${forged}.${s}`, pub));
});

test('OTP is 6 digits, random, hashed per user+purpose', () => {
  const codes = new Set(Array.from({ length: 200 }, otp.generateCode)); assert.ok(codes.size > 150); assert.ok([...codes].every((c) => /^\d{6}$/.test(c)));
  assert.notStrictEqual(otp.hashCode('u1', 'LOGIN', '123456'), otp.hashCode('u2', 'LOGIN', '123456')); assert.notStrictEqual(otp.hashCode('u1', 'LOGIN', '123456'), otp.hashCode('u1', 'RESET_PASSWORD', '123456'));
});
test('OTP verdicts: ok, wrong, expired, retry limit, consumed', () => {
  const mk = (o) => ({ codeHash: otp.hashCode('u1', 'LOGIN', '111111'), expiresAt: new Date(now.getTime() + 300000), attempts: 0, maxAttempts: 5, consumedAt: null, ...o });
  const ev = (o, code = '111111') => otp.evaluate(mk(o), 'u1', 'LOGIN', code, now);
  assert.strictEqual(ev({}), 'OK'); assert.strictEqual(ev({}, '222222'), 'WRONG'); assert.strictEqual(ev({ expiresAt: new Date(now - 1) }), 'EXPIRED');
  assert.strictEqual(ev({ attempts: 5 }), 'LOCKED'); assert.strictEqual(ev({ consumedAt: new Date() }), 'INVALID'); assert.strictEqual(otp.evaluate(null, 'u1', 'LOGIN', '1', now), 'INVALID');
});
test('AUTH schemas: password rules and confirm mismatch', () => {
  const ok = { email: 'A@B.com', password: 'abcdef12345', confirmPassword: 'abcdef12345' };
  assert.strictEqual(S.register.parse(ok).email, 'a@b.com');
  assert.ok(!S.register.safeParse({ ...ok, confirmPassword: 'x' }).success); assert.ok(!S.register.safeParse({ ...ok, password: 'short1', confirmPassword: 'short1' }).success); assert.ok(!S.register.safeParse({ ...ok, password: 'onlyletterspw', confirmPassword: 'onlyletterspw' }).success);
});

const pay = { tranId: 'T1', currency: 'BDT', amountMinor: 50000 };
test('PAYMENT validation accepts a matching VALID answer', () => assert.strictEqual(ssl.checkValidation({ status: 'VALID', tran_id: 'T1', currency_type: 'BDT', amount: '500.00' }, pay), null));
test('PAYMENT rejects failed status, wrong tran id, currency mismatch, amount mismatch', () => {
  const v = { status: 'VALID', tran_id: 'T1', currency_type: 'BDT', amount: '500.00' };
  assert.match(ssl.checkValidation({ ...v, status: 'FAILED' }, pay), /did not confirm/); assert.match(ssl.checkValidation({ ...v, tran_id: 'T2' }, pay), /Transaction id/);
  assert.match(ssl.checkValidation({ ...v, currency_type: 'USD' }, pay), /Currency/); assert.match(ssl.checkValidation({ ...v, amount: '1.00' }, pay), /Amount/); assert.match(ssl.checkValidation(null, pay), /did not confirm/);
});
test('PAYMENT IPN signature: valid passes, tampered fails', () => {
  const body = { tran_id: 'T1', amount: '500.00', status: 'VALID', val_id: 'V1' }; body.verify_key = 'amount,status,store_passwd,tran_id,val_id';
  body.verify_sign = ssl.md5(['amount=500.00', 'status=VALID', `store_passwd=${ssl.md5('secret')}`, 'tran_id=T1', 'val_id=V1'].join('&'));
  assert.ok(ssl.verifyIpnSignature(body, 'secret')); assert.ok(!ssl.verifyIpnSignature({ ...body, amount: '1.00' }, 'secret')); assert.ok(!ssl.verifyIpnSignature({ tran_id: 'T1' }, 'secret'));
});
test('MFS submission schema: sender number, txn id, positive amount', () => {
  const ok = { planId: 'a'.repeat(24), providerId: 'b'.repeat(24), transactionId: '8N7A6D5EE1', senderNumber: '01712345678', amount: 499 };
  assert.ok(S.manualPayment.safeParse(ok).success); assert.ok(!S.manualPayment.safeParse({ ...ok, amount: 0 }).success); assert.ok(!S.manualPayment.safeParse({ ...ok, senderNumber: 'abc' }).success); assert.ok(!S.manualPayment.safeParse({ ...ok, transactionId: 'a b' }).success);
});
test('CONSUME schema accepts extra features and rejects unknown ones', () => {
  assert.deepStrictEqual(S.consume.parse({ feature: 'videoCompression', also: ['batchProcessing'], clientJobId: 'abcdefgh' }).also, ['batchProcessing']);
  assert.ok(!S.consume.safeParse({ feature: 'videoCompression', also: ['root'], clientJobId: 'abcdefgh' }).success);
  assert.deepStrictEqual(S.consume.parse({ feature: 'pdfMerge', clientJobId: 'abcdefgh' }).also, []);
});

const ident = require('../src/utils/identity');
test('REFUND gateway answers map safely: unknown or missing answers are never treated as success', () => {
  assert.strictEqual(ssl.interpretRefund({ status: 'success', refund_ref_id: 'R1' }).state, 'SUCCESS');
  assert.strictEqual(ssl.interpretRefund({ status: 'refunded' }).state, 'SUCCESS');
  assert.strictEqual(ssl.interpretRefund({ status: 'processing' }).state, 'PROCESSING');
  assert.strictEqual(ssl.interpretRefund({ status: 'failed', errorReason: 'balance too low' }).reason, 'balance too low');
  for (const bad of [null, undefined, {}, { status: 'weird' }, { status: '' }]) assert.strictEqual(ssl.interpretRefund(bad).state, 'FAILED');
});
test('REFUND schema needs a reason; viaGateway defaults on', () => {
  assert.strictEqual(S.refund.parse({ reason: 'customer asked' }).viaGateway, true); assert.ok(!S.refund.safeParse({ reason: 'x' }).success); assert.ok(!S.refund.safeParse({}).success);
});
test('ABUSE: gmail dots, +tags and googlemail collapse to one inbox; other domains keep dots', () => {
  assert.strictEqual(ident.canonicalEmail('A.B+promo@Gmail.com'), 'ab@gmail.com'); assert.strictEqual(ident.canonicalEmail('ab@googlemail.com'), 'ab@gmail.com');
  assert.strictEqual(ident.canonicalEmail('first.last+x@company.com'), 'first.last@company.com'); assert.notStrictEqual(ident.canonicalEmail('a@b.com'), ident.canonicalEmail('a@c.com'));
});
test('VERSION compare and settings validation', () => {
  assert.strictEqual(ident.cmpVersion('0.1.0', '0.1.0'), 0); assert.strictEqual(ident.cmpVersion('0.0.9', '0.1.0'), -1); assert.strictEqual(ident.cmpVersion('1.10.0', '1.9.9'), 1);
  assert.ok(S.settingsGroup.app.safeParse({ minDesktopVersion: '1.2.3' }).success); assert.ok(!S.settingsGroup.app.safeParse({ minDesktopVersion: 'latest' }).success);
  assert.ok(S.settingsGroup.security.safeParse({ blockedEmailDomains: ['mailinator.com'] }).success); assert.ok(!S.settingsGroup.security.safeParse({ blockedEmailDomains: ['not a domain'] }).success);
});
test('SCREENSHOT validation checks magic bytes, declared type and size', () => {
  const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64'), jpg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
  assert.strictEqual(ident.checkScreenshot(png), null); assert.strictEqual(ident.checkScreenshot(jpg), null);
  assert.match(ident.checkScreenshot('data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64')), /does not match/);
  assert.match(ident.checkScreenshot('data:image/jpeg;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')), /does not match/);
  assert.match(ident.checkScreenshot('data:text/html;base64,PGI+'), /PNG or JPEG/); assert.match(ident.checkScreenshot(png, 3), /too large/); assert.match(ident.checkScreenshot(undefined), /PNG or JPEG/);
});
test('REAUTH middleware: blocks without recent confirmation, allows inside the window, can be switched off', async () => {
  const reauth = require('../src/services/reauth'); const settings = require('../src/services/settings'); const orig = settings.get;
  settings.get = async (k) => ({ ...settings.DEFAULTS[k] });
  const run = (user) => new Promise((resolve) => reauth.required({ user }, {}, (e) => resolve(e)));
  assert.strictEqual((await run({})).code, 'REAUTH_REQUIRED'); assert.strictEqual((await run({ reauthUntil: new Date(Date.now() - 1000) })).code, 'REAUTH_REQUIRED');
  assert.strictEqual(await run({ reauthUntil: new Date(Date.now() + 60000) }), undefined);
  settings.get = async (k) => ({ ...settings.DEFAULTS[k], ...(k === 'security' ? { adminReauthRequired: false } : {}) }); assert.strictEqual(await run({}), undefined); settings.get = orig;
});
