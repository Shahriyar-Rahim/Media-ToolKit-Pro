const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const money = (m, c) => `${(Number(m) / 100).toFixed(2)} ${c}`;
const discountLabel = (d) => (d ? (d.name ? `${d.name} (${d.code})` : d.code) : null);

// Pure: everything a memo shows (in the email table and the PDF), built from records that are already loaded.
function buildMemo(o) {
  const { orderId, user, plan, sub, method, reference, senderNumber, discount, originalMinor, discountMinor = 0, finalMinor, paidMinor, currency, status, date } = o;
  const period = sub ? (sub.isLifetime ? 'Lifetime (no expiry)' : `${day(sub.startsAt)} to ${day(sub.endsAt)}`) : null;
  const disc = discount || discountMinor > 0 ? `${discountLabel(discount) || 'Discount'}: -${money(discountMinor, currency)}` : null;
  const rows = [['Order ID', orderId], ['Date', day(date || new Date())], ['Status', status], user.name && ['Customer', user.name], ['Email', user.email], ['Plan', plan.name], period && ['Plan period', period],
    ['Payment method', method], reference && ['Transaction ID', reference], senderNumber && ['Sent from', senderNumber], ['Price', money(originalMinor, currency)], disc && ['Discount', disc], ['Total', money(finalMinor, currency)],
    paidMinor != null && paidMinor !== finalMinor && ['Amount received', money(paidMinor, currency)]].filter(Boolean);
  return { orderId, status, rows };
}

const wrap = (s, n) => { const out = []; let line = ''; for (const w of String(s).split(' ')) { if ((line + ' ' + w).trim().length > n) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim(); } if (line) out.push(line); return out.length ? out : ['']; };
// The PDF uses a built-in font that only knows Latin letters; anything else is shown as "?" in the PDF (the email table keeps full Unicode).
const latin = (s) => String(s).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

async function memoPdf(memo, appName = 'Media Toolkit Pro') {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold); const grey = rgb(0.8, 0.8, 0.8);
  let y = 790; page.drawText(latin(appName), { x: 50, y, size: 22, font: bold }); y -= 26; page.drawText('PAYMENT MEMO', { x: 50, y, size: 12, font: bold, color: rgb(0.04, 0.49, 0.55) });
  y -= 14; page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: grey }); y -= 30;
  for (const [k, v] of memo.rows) { const lines = wrap(latin(v), 56); page.drawText(latin(k), { x: 50, y, size: 11, font: bold }); lines.forEach((ln, i) => page.drawText(ln, { x: 200, y: y - i * 14, size: 11, font })); y -= 22 + (lines.length - 1) * 14; }
  y -= 8; page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: grey }); page.drawText('This memo was generated automatically and is valid without a signature.', { x: 50, y: y - 20, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  return Buffer.from(await pdf.save());
}
module.exports = { buildMemo, memoPdf, money, discountLabel };
