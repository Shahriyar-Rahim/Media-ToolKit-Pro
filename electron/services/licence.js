const crypto = require('crypto');

const b64 = (s) => Buffer.from(s, 'base64url');
// ES256 JWT verification with the embedded PUBLIC key only. The server signs; the app can only verify.
function verifySnapshot(token, pem, nowMs) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) throw new Error('bad token');
  if (JSON.parse(b64(h)).alg !== 'ES256') throw new Error('bad alg');
  if (!crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pem, dsaEncoding: 'ieee-p1363' }, b64(s))) throw new Error('bad signature');
  const payload = JSON.parse(b64(p));
  if (!payload.exp || payload.exp * 1000 < nowMs) throw new Error('snapshot expired');
  return payload;
}

// One feature is consumed per job; extras must merely be allowed.
function requiredFeatures(type, options = {}, fileCount = 1) {
  const primary = { video: { hardware: 'hardwareAcceleration', max: 'maximumCompression' }[options.mode] || 'videoCompression', audio: 'audioConversion', heic: 'heicConversion', imagesToPdf: 'pdfCreate', mergePdf: 'pdfMerge' }[type];
  const also = [];
  if (type === 'video' && ['hardware', 'max'].includes(options.mode)) also.push('videoCompression');
  if (['video', 'audio', 'heic'].includes(type) && fileCount > 1) also.push('batchProcessing');
  return { feature: primary, also };
}

function createLicence({ db, api, publicKey, now = () => Date.now(), uuid = () => crypto.randomUUID(), clockSkewMs = 5 * 60000 }) {
  const load = () => db.getSetting('lic', { user: null, token: null, ent: null, pending: [], lastSeen: 0 });
  const save = (c) => db.setSetting('lic', c);

  function view(c, offline) {
    if (!c.user) return { signedIn: false };
    let e = c.ent || { source: 'NONE', features: {}, limits: {} };
    if (e.endsAt && new Date(e.endsAt).getTime() < now() && e.source !== 'NONE') e = { ...e, source: 'NONE', features: {}, planName: null, expiredWhileOffline: true };
    return { signedIn: true, user: c.user, offline, entitlement: { source: e.source, planName: e.planName, lifetime: !!e.lifetime, endsAt: e.endsAt || null, features: e.features, limits: e.limits, trialExpired: !!e.trialExpired }, remaining: c.remaining || {}, pendingSync: c.pending.length, updateRequired: c.updateRequired || null };
  }
  const state = (offline = false) => view(load(), offline);
  const clear = () => save({ user: null, token: null, ent: null, pending: [], lastSeen: 0 }); // on logout: nobody else can ride the cached entitlement

  async function syncPending() {
    const c = load(); const left = [];
    for (let i = 0; i < c.pending.length; i++) {
      const j = c.pending[i]; const r = await api.request('POST', '/api/usage/consume', { feature: j.feature, also: j.also, clientJobId: j.clientJobId, fileSizeBytes: j.fileSize });
      if (r.networkError) { left.push(...c.pending.slice(i)); break; } // still offline: keep the rest
      if (r.status === 401) { left.push(...c.pending.slice(i)); break; }
      // 200 = counted (idempotent by clientJobId); 402 = server refuses but the work already ran, so drop it
    }
    const n = load(); n.pending = left; save(n);
  }

  async function refresh() {
    const r = await api.request('GET', '/api/usage/entitlement');
    if (r.networkError) return state(true);
    if (r.status === 401) { clear(); return state(); }
    if (r.status === 426) { const c = load(); c.updateRequired = r.data.minVersion || true; save(c); return state(true); } // outdated app: online features paused, local tools keep working
    if (r.status !== 200) return state(false);
    const c = load(); c.token = r.data.snapshot; c.updateRequired = null; c.ent = r.data.entitlement; c.remaining = r.data.entitlement.remaining || {}; c.lastSeen = Math.max(c.lastSeen || 0, now()); save(c);
    await syncPending(); return state(false);
  }

  async function boot() {
    const r = await api.request('GET', '/api/auth/me');
    if (r.networkError) { const c = load(); return c.user && c.token && offlineOk(c) ? state(true) : { signedIn: false, offlineNoCache: !!c.user }; }
    if (r.status !== 200) { clear(); return { signedIn: false }; }
    const prev = load(); if (prev.user && String(prev.user.id) !== String(r.data.user.id)) clear(); // a DIFFERENT account on this computer must never inherit the previous account's cached plan or queued offline usage
    const c = load(); c.user = r.data.user; save(c); return refresh();
  }
  function offlineOk(c) { try { if (!publicKey) return false; verifySnapshot(c.token, publicKey, now()); return true; } catch { return false; } }

  async function logout() { await api.request('POST', '/api/auth/logout'); clear(); return { signedIn: false }; }

  // Called before every job starts. Returns clientJobId, or throws a user-safe message.
  async function gate({ type, options, fileSize = 0, fileCount = 1 }) {
    const { feature, also } = requiredFeatures(type, options, fileCount); const clientJobId = uuid();
    const c0 = load(); if (!c0.user) throw new Error('Please sign in to use this tool.');
    const r = await api.request('POST', '/api/usage/consume', { feature, also, clientJobId, fileSizeBytes: fileSize });
    if (r.status === 200) { const c = load(); c.ent = r.data.entitlement; c.remaining = r.data.entitlement.remaining || c.remaining; c.lastSeen = Math.max(c.lastSeen || 0, now()); save(c); return clientJobId; }
    if (r.status === 402) throw new Error(r.data.error);
    if (r.status === 401) { clear(); throw new Error('Your session expired. Please sign in again.'); }
    if (r.status === 426) { const c = load(); c.updateRequired = r.data.minVersion || true; save(c); } // fall through to the offline rules
    if ((r.status === 503 && r.data && r.data.code === 'MAINTENANCE') || r.status === 426) { /* local tools keep working under the offline rules */ }
    else if (!r.networkError) throw new Error(r.data && r.data.error ? r.data.error : 'Could not verify your plan. Try again.');
    return offlineGate(feature, also, fileSize, clientJobId);
  }

  function offlineGate(feature, also, fileSize, clientJobId) {
    const c = load();
    if (!c.token) throw new Error('You are offline. Sign in online once to enable offline use.');
    let p; try { if (!publicKey) throw new Error('no key'); p = verifySnapshot(c.token, publicKey, now()); } catch { throw new Error('Offline access has expired. Connect to the internet to refresh your plan.'); }
    if (p.sub !== String(c.user.id)) throw new Error('Offline data belongs to another account. Sign in online.');
    if (now() < (c.lastSeen || 0) - clockSkewMs) throw new Error('Your system clock looks wrong. Fix the date and time, or go online.'); // blocks the rewind-the-clock trick
    const e = view({ ...c, ent: p.ent }, true).entitlement;
    if (e.source === 'NONE') throw new Error('No active plan. Connect to the internet to refresh your plan.');
    for (const f of [feature, ...also]) if (!e.features[f]) throw new Error('Your plan does not include this tool.');
    if (e.limits.maxFileSizeMB != null && fileSize > e.limits.maxFileSizeMB * 1048576) throw new Error(`File is larger than your ${e.limits.maxFileSizeMB} MB limit.`);
    const used = c.pending.length; // usage recorded offline but not yet synced counts against the last known remaining
    for (const k of ['today', 'month', 'total']) if (p.remaining && p.remaining[k] != null && p.remaining[k] - used <= 0) throw new Error('Usage limit reached. Connect to the internet to refresh, or upgrade.');
    c.pending.push({ clientJobId, feature, also, fileSize, at: now() }); c.lastSeen = Math.max(c.lastSeen || 0, now()); save(c);
    return clientJobId;
  }
  return { boot, refresh, state, logout, gate, syncPending, clear };
}
module.exports = { createLicence, verifySnapshot, requiredFeatures };
