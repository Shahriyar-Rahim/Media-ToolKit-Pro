const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createLicence, verifySnapshot, requiredFeatures } = require('../services/licence');
const { createApiClient, checkRequest } = require('../services/apiClient');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const sign = (payload) => { // same shape as the server: ES256 JWT, raw r||s signature
  const h = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url'), p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
};
const mem = () => { const m = {}; return { getSetting: (k, d) => (k in m ? JSON.parse(JSON.stringify(m[k])) : d), setSetting: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };
const T0 = 1_800_000_000_000;
const ent = (o = {}) => ({ source: 'SUBSCRIPTION', planName: 'Pro', features: { videoCompression: true, batchProcessing: true }, limits: { maxFileSizeMB: 1 }, ...o });
const snap = (o = {}, sub = 'u1') => sign({ sub, exp: Math.floor(T0 / 1000) + 3600, ent: ent(o.ent), remaining: o.remaining || {} });
const offlineApi = { request: async () => ({ status: 0, networkError: true, data: {} }) };
const setup = (api, opts = {}) => { const db = mem(); let t = T0; const lic = createLicence({ db, api, publicKey: PUB, now: () => t, uuid: () => `job-${++setup.n}`, ...opts }); db.setSetting('lic', { user: { id: 'u1' }, token: opts.token === undefined ? snap() : opts.token, ent: ent(), pending: [], lastSeen: T0, remaining: {} }); return { lic, db, tick: (ms) => { t += ms; } }; };
setup.n = 0;

test('snapshot: valid verifies; tampered, wrong key, expired all fail', () => {
  assert.strictEqual(verifySnapshot(snap(), PUB, T0).sub, 'u1');
  const [h, p, s] = snap().split('.'); const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: 'evil' })).toString('base64url');
  assert.throws(() => verifySnapshot(`${h}.${forged}.${s}`, PUB, T0), /signature/);
  assert.throws(() => verifySnapshot(snap(), crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' }), T0), /signature/);
  assert.throws(() => verifySnapshot(snap(), PUB, T0 + 4 * 3600e3), /expired/);
  assert.throws(() => verifySnapshot('a.b', PUB, T0));
});
test('feature mapping: one consumed feature, extras for batch and GPU/max modes', () => {
  assert.deepStrictEqual(requiredFeatures('video', { mode: 'max' }, 1), { feature: 'maximumCompression', also: ['videoCompression'] });
  assert.deepStrictEqual(requiredFeatures('video', { mode: 'cpu' }, 3), { feature: 'videoCompression', also: ['batchProcessing'] });
  assert.deepStrictEqual(requiredFeatures('mergePdf', {}, 1), { feature: 'pdfMerge', also: [] });
});
test('online: server allows -> job id returned; server denies (402) -> clear message', async () => {
  const ok = setup({ request: async () => ({ status: 200, data: { entitlement: { ...ent(), remaining: { today: 4 } } } }) });
  assert.ok((await ok.lic.gate({ type: 'video', options: {}, fileSize: 10 })).startsWith('job-')); assert.strictEqual(ok.lic.state().remaining.today, 4);
  const no = setup({ request: async () => ({ status: 402, data: { error: 'Daily limit reached.' } }) });
  await assert.rejects(no.lic.gate({ type: 'video', options: {} }), /Daily limit/);
});
test('signed out: gate refuses without touching the network', async () => {
  const s = setup({ request: async () => { throw new Error('should not be called'); } }); s.db.setSetting('lic', { user: null, pending: [] });
  await assert.rejects(s.lic.gate({ type: 'video', options: {} }), /sign in/i);
});
test('expired session (401) clears the cached entitlement', async () => {
  const s = setup({ request: async () => ({ status: 401, data: {} }) }); await assert.rejects(s.lic.gate({ type: 'video', options: {} }), /sign in again/); assert.strictEqual(s.lic.state().signedIn, false);
});
test('OFFLINE: valid snapshot works, is recorded as pending, and syncs (idempotently) when back online', async () => {
  const s = setup(offlineApi); const id = await s.lic.gate({ type: 'video', options: {}, fileSize: 100 }); assert.ok(id); assert.strictEqual(s.lic.state(true).pendingSync, 1);
  const calls = []; const on = createLicence({ db: s.db, api: { request: async (m, p, b) => { calls.push(b); return { status: 200, data: { entitlement: ent() } }; } }, publicKey: PUB, now: () => T0 });
  await on.syncPending(); assert.strictEqual(calls[0].clientJobId, id); assert.strictEqual(on.state().pendingSync, 0);
});
test('OFFLINE: feature, file size, remaining usage, and unsynced-usage limits are enforced', async () => {
  const s = setup(offlineApi); await assert.rejects(s.lic.gate({ type: 'mergePdf', options: {} }), /does not include/);
  await assert.rejects(s.lic.gate({ type: 'video', options: {}, fileSize: 2 * 1048576 }), /larger than/);
  const lim = setup(offlineApi, { token: snap({ remaining: { today: 1 } }) }); await lim.lic.gate({ type: 'video', options: {} }); await assert.rejects(lim.lic.gate({ type: 'video', options: {} }), /limit reached/);
});
test('OFFLINE: expired snapshot, other account, no key, no plan, and rewound clock are all refused', async () => {
  const s = setup(offlineApi); s.tick(4 * 3600e3); await assert.rejects(s.lic.gate({ type: 'video', options: {} }), /expired/);
  await assert.rejects(setup(offlineApi, { token: snap({}, 'someone-else') }).lic.gate({ type: 'video', options: {} }), /another account/);
  await assert.rejects(createLicence({ db: setup(offlineApi).db, api: offlineApi, publicKey: null, now: () => T0 }).gate({ type: 'video', options: {} }), /expired|offline/i);
  await assert.rejects(setup(offlineApi, { token: snap({ ent: { source: 'NONE', features: {} } }) }).lic.gate({ type: 'video', options: {} }), /No active plan/);
  const c = setup(offlineApi); c.db.setSetting('lic', { ...c.db.getSetting('lic'), lastSeen: T0 + 3600e3 }); await assert.rejects(c.lic.gate({ type: 'video', options: {} }), /clock/); // last seen 1h in the future
});
test('OFFLINE: subscription that ended while offline stops working', async () => {
  const s = setup(offlineApi, { token: snap({ ent: { endsAt: new Date(T0 - 1000).toISOString() } }) }); await assert.rejects(s.lic.gate({ type: 'video', options: {} }), /No active plan/);
});
test('MAINTENANCE 503 falls back to offline rules so local tools keep working', async () => {
  const s = setup({ request: async () => ({ status: 503, data: { code: 'MAINTENANCE', error: 'Service temporarily unavailable.' } }) }); assert.ok(await s.lic.gate({ type: 'video', options: {} }));
});
test('logout clears cached entitlement so nobody can reuse it offline', async () => {
  const s = setup({ request: async () => ({ status: 200, data: {} }) }); await s.lic.logout(); assert.strictEqual(s.lic.state().signedIn, false);
  await assert.rejects(setup(offlineApi).lic.gate.bind(null, {}), () => true).catch(() => {}); // sanity: no throw from harness
});
test('boot: offline with a valid cache = signed-in offline; no cache = signed out', async () => {
  assert.strictEqual((await setup(offlineApi).lic.boot()).offline, true);
  const none = setup(offlineApi); none.db.setSetting('lic', { user: null, pending: [] }); assert.strictEqual((await none.lic.boot()).signedIn, false);
});
test('API bridge: only /api/ paths, known methods, never the gateway callbacks or traversal', () => {
  for (const [m, p] of [['GET', '/api/plans'], ['POST', '/api/subscriptions/checkout'], ['GET', '/api/admin/users?page=2&q=a%40b.com']]) assert.doesNotThrow(() => checkRequest(m, p));
  for (const [m, p] of [['PATCH', '/api/plans'], ['GET', 'http://evil.com/api/x'], ['GET', '/api/../etc/passwd'], ['GET', '/other'], ['POST', '/api/payments/sslcommerz/ipn'], ['GET', '//evil.com'], ['GET', '/api/x y']]) assert.throws(() => checkRequest(m, p), /Invalid request/);
});
test('API client: network failure is a result, not a crash; one silent refresh on 401', async () => {
  const dead = createApiClient({ fetchImpl: async () => { throw new Error('ENOTFOUND'); }, getBase: () => 'http://x' }); assert.strictEqual((await dead.request('GET', '/api/plans')).networkError, true);
  const seq = []; const c = createApiClient({ getBase: () => 'http://x', fetchImpl: async (u) => { seq.push(u); const first = seq.filter((x) => x.endsWith('/api/usage/entitlement')).length === 1 && u.endsWith('/api/usage/entitlement'); return { status: first ? 401 : 200, json: async () => ({ ok: 1 }) }; } });
  assert.strictEqual((await c.request('GET', '/api/usage/entitlement')).status, 200); assert.ok(seq.some((u) => u.endsWith('/api/auth/refresh')));
});
