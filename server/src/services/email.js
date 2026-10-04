const nodemailer = require('nodemailer');
const env = require('../config/env');
const settings = require('./settings');
const { EmailLog } = require('../models');

let transport;
const getTransport = () => transport || (transport = env.smtp.host ? nodemailer.createTransport({ host: env.smtp.host, port: env.smtp.port, secure: env.smtp.secure, auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined })
  : nodemailer.createTransport({ jsonTransport: true })); // dev fallback: logs instead of sending
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (m, c) => `${(m / 100).toFixed(2)} ${c}`;

// One reusable layout + a table of small templates. Every value is HTML-escaped.
const T = {
  welcome: (d) => ['Welcome to {app}', `Hi ${esc(d.name || 'there')}, your account is verified and ready.`],
  verifyEmail: (d) => ['Verify your email', `Your verification code is <b style="font-size:20px">${esc(d.code)}</b>. It expires in ${esc(d.minutes)} minutes.`],
  loginOtp: (d) => ['Your sign-in code', `Your sign-in code is <b style="font-size:20px">${esc(d.code)}</b>. It expires in ${esc(d.minutes)} minutes. If this wasn't you, change your password.`],
  passwordReset: (d) => ['Reset your password', `Your password reset code is <b style="font-size:20px">${esc(d.code)}</b>. It expires in ${esc(d.minutes)} minutes. Ignore this email if you didn't ask for it.`],
  subscriptionActivated: (d) => ['Your plan is active', `${esc(d.plan)} is now active${d.endsAt ? ` until ${esc(new Date(d.endsAt).toDateString())}` : ' (lifetime)'}.`],
  subscriptionExpiring: (d) => ['Your plan expires soon', `${esc(d.plan)} expires on ${esc(new Date(d.endsAt).toDateString())}.`],
  subscriptionExpired: (d) => ['Your plan has expired', `${esc(d.plan)} has expired. Renew to keep using premium tools.`],
  paymentReceived: (d) => ['Payment received', `We received ${esc(money(d.amountMinor, d.currency))} for ${esc(d.plan)}.`],
  paymentApproved: (d) => ['Payment approved', `Your manual payment ${esc(d.transactionId)} was approved.`],
  paymentRejected: (d) => ['Payment rejected', `Your manual payment ${esc(d.transactionId)} was rejected.${d.note ? ` Note: ${esc(d.note)}` : ''}`],
  manualPaymentSubmitted: (d) => ['Payment submitted for review', `We received your transaction ${esc(d.transactionId)}. An admin will review it soon.`],
  refundProcessed: (d) => ['Your payment was refunded', `We refunded ${esc(money(d.amountMinor, d.currency))} for ${esc(d.plan)}. Access to that plan has ended.${d.viaGateway ? ' The money returns to your original payment method; timing depends on your bank.' : ''}`],
  bugReceived: (d) => ['Bug report received', `Thanks. Your report ${esc(d.reportId)} is open.`],
  contactReceived: (d) => ['We got your message', `Your message ${esc(d.ticketId)} was received. We'll reply soon.`],
  adminReply: (d) => [`Re: ${d.subject || 'your request'}`, esc(d.message).replace(/\n/g, '<br>')],
};

async function send(template, to, data) {
  const app = (await settings.get('app')).appName;
  const [subject, body] = T[template](data);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px"><h2>${esc(app)}</h2><p>${body}</p></div>`;
  const info = await getTransport().sendMail({ from: env.smtp.from, to, subject: subject.replace('{app}', app), html });
  if (!env.smtp.host && !env.prod) console.log(`[dev email] ${template} -> ${to}`, data.code ? `code=${data.code}` : '');
  return info;
}
// Idempotent: the unique key is claimed BEFORE sending, so repeated callbacks can't produce duplicate mails.
async function sendOnce(key, template, to, data) {
  try { await EmailLog.create({ key, to, template }); } catch (e) { if (e.code === 11000) return false; throw e; }
  try { await module.exports.send(template, to, data); return true; } catch (e) { await EmailLog.deleteOne({ key }); throw e; }
}
const safe = (p) => p.catch((e) => console.error('[email failed]', e.message)); // email trouble must never fail a payment or request
module.exports = { send, sendOnce, safe };
