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
module.exports = { canonicalEmail, cmpVersion, checkScreenshot };
