const asyncHandler = require('../utils/asyncHandler');
const checkout = require('../services/checkout');
const ssl = require('../services/sslcommerz');
const { Payment } = require('../models');
const { audit } = require('../services/audit');

const page = (title, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:460px;margin:15vh auto;padding:0 20px"><h2>${title}</h2><p>${msg}</p></body>`;

exports.quote = asyncHandler(async (req, res) => { const q = await checkout.quote(req.user, req.body); res.json({ plan: { id: q.plan._id, name: q.plan.name }, ...q.price, discountCode: q.discount ? q.discount.code : null }); });
exports.start = asyncHandler(async (req, res) => res.json(await checkout.startCheckout(req.user, req.body)));
exports.submitManual = asyncHandler(async (req, res) => { const mp = await checkout.submitManual(req.user, req.body); res.status(201).json({ id: mp._id, status: mp.status }); });

// Browser lands here from the gateway. The redirect is only UX: the money check happens server-side in completeSsl.
exports.sslSuccess = asyncHandler(async (req, res) => {
  const r = await checkout.completeSsl({ tranId: req.body.tran_id, valId: req.body.val_id });
  res.send(r.ok ? page('Payment successful', 'Your plan is active. You can close this window and return to Media Toolkit Pro.') : page('We are confirming your payment', 'If you were charged, your plan will activate automatically within a few minutes. You can close this window.'));
});
exports.sslFail = asyncHandler(async (req, res) => { await checkout.markSslOutcome(req.body.tran_id, 'FAILED'); res.send(page('Payment failed', 'No charge was made. You can close this window and try again in the app.')); });
exports.sslCancel = asyncHandler(async (req, res) => { await checkout.markSslOutcome(req.body.tran_id, 'CANCELLED'); res.send(page('Payment cancelled', 'You can close this window and try again in the app.')); });
exports.sslIpn = asyncHandler(async (req, res) => {
  if (!ssl.verifyIpnSignature(req.body)) { await audit(req, 'payment.ipn_bad_signature', 'Payment', req.body.tran_id); return res.status(400).json({ ok: false }); }
  const r = await checkout.completeSsl({ tranId: req.body.tran_id, valId: req.body.val_id });
  res.status(r.retry ? 503 : 200).json({ ok: r.ok }); // 503 asks the gateway to retry when validation was unreachable
});
