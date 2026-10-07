// One inbox = one account for trial purposes: strips "+tag", Gmail dots and the googlemail alias.
function canonicalEmail(raw) {
  const [local0, domain0] = String(raw).trim().toLowerCase().split('@'); if (!domain0) return String(raw).toLowerCase();
  let local = local0.split('+')[0], domain = domain0;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}
const cmpVersion = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; };
// Validates a data-URL screenshot by magic bytes and size, never trusting the declared type.
function checkScreenshot(dataUrl, maxBytes = 600000) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || ''); if (!m) return 'Screenshot must be a PNG or JPEG image';
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > maxBytes) return 'Screenshot is too large';
  const png = buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), jpg = buf.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  return (m[1] === 'png' && png) || (m[1] === 'jpeg' && jpg) ? null : 'Screenshot content does not match its type';
}

// Human-friendly, unguessable order numbers like ORD-251005-K7M2QX (no 0/O/1/I/L lookalikes).
const B32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newOrderId(now = new Date()) {
  const ymd = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  let tail = ''; for (const b of require('crypto').randomBytes(6)) tail += B32[b % B32.length];
  return `ORD-${ymd}-${tail}`;
}
// The caller's address as Express resolved it (honours TRUST_PROXY), normalised: IPv4-mapped IPv6 and loopback made readable.
function clientIp(req) {
  let ip = String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '').trim();
  ip = ip.replace(/^::ffff:/i, ''); if (ip === '::1') ip = '127.0.0.1';
  return ip.slice(0, 64) || null;
}
module.exports = { canonicalEmail, cmpVersion, checkScreenshot, newOrderId, clientIp };
