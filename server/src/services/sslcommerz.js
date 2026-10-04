const crypto = require('crypto');
const env = require('../config/env');
const { toGatewayAmount } = require('./pricing');

const base = () => (env.ssl.sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const configured = () => !!(env.ssl.storeId && env.ssl.storePass);

async function initSession({ tranId, amountMinor, currency, user, planName }) {
  const api = `${env.publicApiUrl}/api/payments/sslcommerz`;
  const body = new URLSearchParams({
    store_id: env.ssl.storeId, store_passwd: env.ssl.storePass, total_amount: toGatewayAmount(amountMinor), currency, tran_id: tranId,
    success_url: `${api}/success`, fail_url: `${api}/fail`, cancel_url: `${api}/cancel`, ipn_url: `${api}/ipn`,
    shipping_method: 'NO', product_name: planName.slice(0, 100), product_category: 'Subscription', product_profile: 'non-physical-goods',
    cus_name: user.name || 'Customer', cus_email: user.email, cus_add1: 'N/A', cus_city: 'Dhaka', cus_country: 'Bangladesh', cus_phone: '01700000000', num_of_item: '1',
  });
  const r = await fetch(`${base()}/gwprocess/v4/api.php`, { method: 'POST', body, signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  if (j.status !== 'SUCCESS' || !j.GatewayPageURL) throw new Error(`SSLCommerz session failed: ${j.failedreason || 'unknown'}`);
  return j.GatewayPageURL;
}

async function validate(valId) {
  const q = new URLSearchParams({ val_id: valId, store_id: env.ssl.storeId, store_passwd: env.ssl.storePass, format: 'json' });
  const r = await fetch(`${base()}/validator/api/validationserverAPI.php?${q}`, { signal: AbortSignal.timeout(20000) });
  return r.json();
}

// IPN integrity hash (defence in depth; the authoritative check is validate() above).
function verifyIpnSignature(body, storePass = env.ssl.storePass) {
  if (!body.verify_sign || !body.verify_key) return false;
  const data = { ...body, store_passwd: md5(storePass) };
  const str = body.verify_key.split(',').sort().map((k) => `${k}=${data[k]}`).join('&');
  return md5(str) === body.verify_sign;
}

// Pure: is the gateway's validation answer acceptable for THIS payment? Every mismatch is a hard reject.
function checkValidation(v, payment) {
  if (!v || !['VALID', 'VALIDATED'].includes(v.status)) return 'Gateway did not confirm the payment';
  if (v.tran_id !== payment.tranId) return 'Transaction id mismatch';
  if (String(v.currency_type || v.currency).toUpperCase() !== payment.currency) return 'Currency mismatch';
  if (Math.round(parseFloat(v.currency_amount || v.amount) * 100) !== payment.amountMinor && Math.round(parseFloat(v.amount) * 100) !== payment.amountMinor) return 'Amount mismatch';
  return null;
}
const api = (extra) => `${base()}/validator/api/merchantTransIDvalidationAPI.php?${new URLSearchParams({ ...extra, store_id: env.ssl.storeId, store_passwd: env.ssl.storePass, v: '1', format: 'json' })}`;
async function refund({ bankTranId, amountMinor, reason, refId }) {
  const r = await fetch(api({ bank_tran_id: bankTranId, refund_amount: toGatewayAmount(amountMinor), refund_remarks: String(reason).slice(0, 200), refe_id: refId }), { signal: AbortSignal.timeout(30000) });
  return r.json();
}
async function refundStatus(refId) { const r = await fetch(api({ refund_ref_id: refId }), { signal: AbortSignal.timeout(30000) }); return r.json(); }
// Pure: map the gateway's answer to our three outcomes. Anything unrecognised is treated as FAILED (never assume money moved).
function interpretRefund(r) {
  const s = String((r && r.status) || '').toLowerCase();
  if (s === 'success' || s === 'refunded') return { state: 'SUCCESS', ref: r.refund_ref_id };
  if (s === 'processing') return { state: 'PROCESSING', ref: r.refund_ref_id };
  return { state: 'FAILED', reason: (r && (r.errorReason || r.error || r.status)) || 'no answer from gateway' };
}
module.exports = { refund, refundStatus, interpretRefund, configured, initSession, validate, verifyIpnSignature, checkValidation, md5 };
