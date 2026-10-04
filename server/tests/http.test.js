process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const settings = require('../src/services/settings');
settings.get = async (k) => ({ ...settings.DEFAULTS[k] }); // no DB in this suite: only guards that run before any query
const { createApp } = require('../src/app');
let server, base;
test.before(async () => { await new Promise((r) => { server = createApp().listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const call = (path, opt = {}) => fetch(base + path, { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) }, body: opt.body && JSON.stringify(opt.body) });

test('ADMIN routes reject anonymous requests', async () => { for (const p of ['/api/admin/dashboard', '/api/admin/users', '/api/admin/settings']) assert.strictEqual((await call(p)).status, 401); });
test('customer routes need auth', async () => { for (const p of ['/api/usage/entitlement', '/api/payments/mine', '/api/auth/me']) assert.strictEqual((await call(p)).status, 401); });
test('a forged/garbage session cookie is rejected', async () => assert.strictEqual((await call('/api/admin/dashboard', { headers: { cookie: 'mtp_at=abc.def.ghi' } })).status, 401));
test('payment + checkout require auth (client cannot skip login)', async () => { assert.strictEqual((await call('/api/subscriptions/checkout', { method: 'POST', body: { planId: 'a'.repeat(24) } })).status, 401); assert.strictEqual((await call('/api/manual-payments', { method: 'POST', body: {} })).status, 401); });
test('registration validates input server-side', async () => { const r = await call('/api/auth/register', { method: 'POST', body: { email: 'nope', password: 'x', confirmPassword: 'y' } }); assert.strictEqual(r.status, 400); assert.strictEqual((await r.json()).code, 'VALIDATION'); });
test('contact and bug forms validate input', async () => { assert.strictEqual((await call('/api/contact', { method: 'POST', body: { name: '', email: 'x' } })).status, 400); assert.strictEqual((await call('/api/bugs', { method: 'POST', body: { title: 'a' } })).status, 400); });
test('OTP endpoint rejects malformed codes before any lookup', async () => assert.strictEqual((await call('/api/auth/verify-email', { method: 'POST', body: { email: 'a@b.com', code: '12' } })).status, 400));
test('SSLCommerz IPN with a bad signature is rejected (no activation path)', async () => { const r = await fetch(`${base}/api/payments/sslcommerz/ipn`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'tran_id=T1&val_id=V1&status=VALID' }); assert.strictEqual(r.status, 400); });
test('security headers present, no x-powered-by, oversized body rejected', async () => {
  const r = await call('/health'); assert.ok(r.headers.get('x-content-type-options')); assert.strictEqual(r.headers.get('x-powered-by'), null);
  const big = await fetch(`${base}/api/contact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(200000) }) }); assert.strictEqual(big.status, 413);
});
test('unknown routes 404 as JSON', async () => assert.strictEqual((await call('/api/nope')).status, 404));
test('maintenance mode blocks online features but not health/status', async () => {
  const orig = settings.get; settings.get = async (k) => ({ ...settings.DEFAULTS[k], ...(k === 'app' ? { maintenanceMode: true } : {}) });
  assert.strictEqual((await call('/api/plans')).status, 503); assert.strictEqual((await call('/health')).status, 200); assert.strictEqual((await call('/api/app/status')).status, 200); settings.get = orig;
});

test('refund, reset-access, reauth and assign endpoints reject anonymous requests', async () => {
  for (const [m, p] of [['POST', '/api/admin/payments/ssl/x/refund'], ['POST', '/api/admin/payments/manual/x/refund'], ['POST', '/api/admin/users/x/reset-access'], ['POST', '/api/admin/reauth/request'], ['PUT', '/api/admin/bugs/x/assign'], ['GET', '/api/admin/version']])
    assert.strictEqual((await call(p, { method: m, body: m === 'GET' ? undefined : {} })).status, 401, p);
});
test('VERSION gate: outdated desktop gets 426 on online features; auth, status and header-less clients are unaffected', async () => {
  const h = (v) => ({ 'x-client-version': v });
  const old = await call('/api/plans', { headers: h('0.0.1') }); assert.strictEqual(old.status, 426); assert.strictEqual((await old.json()).code, 'UPGRADE_REQUIRED');
  assert.notStrictEqual((await call('/api/auth/me', { headers: h('0.0.1') })).status, 426); assert.strictEqual((await call('/api/app/status', { headers: h('0.0.1') })).status, 200);
  assert.notStrictEqual((await call('/api/admin/dashboard', { headers: h('0.0.1') })).status, 426); assert.notStrictEqual((await call('/api/usage/entitlement', { headers: h('0.1.0') })).status, 426);
});
test('bug report: bad screenshot is rejected before storage; oversized body is 413', async () => {
  const bad = await call('/api/bugs', { method: 'POST', body: { title: 'Crash', description: 'It crashed on start', screenshot: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') } });
  assert.strictEqual(bad.status, 400); assert.strictEqual((await bad.json()).code, 'BAD_SCREENSHOT');
  const huge = await fetch(`${base}/api/bugs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', description: 'y'.repeat(1_200_000) }) }); assert.strictEqual(huge.status, 413);
});
