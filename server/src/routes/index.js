const express = require('express');
const { S } = require('../validators/schemas');
const { validate } = require('../middleware/common');
const { requireAuth, requireVerified, requireAdmin, requireSuper } = require('../middleware/auth');
const { limits } = require('../middleware/security');
const reauth = require('../services/reauth'); const recent = reauth.required;
const c = { auth: require('../controllers/auth'), pub: require('../controllers/public'), acct: require('../controllers/account'), pay: require('../controllers/payments'), adm: require('../controllers/admin') };
const optionalAuth = (req, res, next) => (req.cookies.mtp_at ? requireAuth(req, res, (e) => next(e && e.status === 401 ? undefined : e)) : next());

const r = express.Router();
// ---- auth ----
const a = express.Router();
a.post('/register', limits.auth, validate(S.register), c.auth.register);
a.post('/verify-email', limits.otp, validate(S.otpVerify), c.auth.verifyEmail);
a.post('/resend-verification', limits.otp, validate(S.emailOnly), c.auth.resendVerification);
a.post('/login', limits.login, validate(S.login), c.auth.login);
a.post('/login/otp', limits.otp, validate(S.otpVerify), c.auth.loginOtp);
a.post('/refresh', limits.auth, c.auth.refresh);
a.post('/logout', c.auth.logout);
a.post('/forgot-password', limits.reset, validate(S.emailOnly), c.auth.forgot);
a.post('/reset-password', limits.reset, validate(S.reset), c.auth.reset);
a.post('/change-password', requireAuth, limits.reset, validate(S.changePassword), c.auth.changePassword);
a.get('/me', requireAuth, c.auth.me);
a.post('/two-factor', requireAuth, requireVerified, (req, _res, next) => { req.body = { enabled: !!req.body.enabled }; next(); }, c.auth.toggle2fa);
r.use('/auth', a);
// ---- public ----
r.get('/app/status', c.pub.status);
r.get('/plans', c.pub.plans);
r.get('/payments/methods', c.pub.methods);
r.get('/help/faq', c.pub.faq);
r.post('/contact', limits.contact, validate(S.contact), c.pub.contact);
r.post('/bugs', limits.bug, optionalAuth, validate(S.bug), c.pub.bug);
// ---- signed-in customer ----
r.get('/usage/entitlement', requireAuth, c.acct.entitlement);
r.post('/usage/consume', requireAuth, requireVerified, validate(S.consume), c.acct.consume);
r.get('/subscriptions/mine', requireAuth, c.acct.subscriptions);
r.get('/payments/mine', requireAuth, c.acct.payments);
r.get('/bugs/mine', requireAuth, c.acct.myBugs);
r.post('/subscriptions/quote', requireAuth, requireVerified, validate(S.quote), c.pay.quote);
r.post('/subscriptions/checkout', requireAuth, requireVerified, limits.payment, validate(S.checkout), c.pay.start);
r.post('/manual-payments', requireAuth, requireVerified, limits.manual, validate(S.manualPayment), c.pay.submitManual);
// ---- SSLCommerz callbacks (gateway -> server; form-encoded, no cookies, verified server-side) ----
const cb = express.Router(); cb.use(express.urlencoded({ extended: false, limit: '20kb' }));
cb.post('/success', c.pay.sslSuccess); cb.post('/fail', c.pay.sslFail); cb.post('/cancel', c.pay.sslCancel); cb.post('/ipn', c.pay.sslIpn);
r.use('/payments/sslcommerz', cb);
// ---- admin ----
const d = express.Router(); const adm = c.adm;
d.use(limits.admin, requireAdmin);
const idBody = require('zod').z;
d.get('/dashboard', adm.dashboard); d.get('/reports', adm.reports);
d.get('/users', validate(S.page, 'query'), adm.users); d.get('/users/:id', adm.user);
d.post('/users/:id/disable', recent, adm.setDisabled(true)); d.post('/users/:id/enable', recent, adm.setDisabled(false));
d.post('/users/:id/reset-access', recent, validate(S.resetAccess), adm.resetAccess);
d.post('/users/:id/grant', recent, validate(idBody.object({ planId: require('../validators/schemas').oid })), adm.grant);
d.post('/subscriptions/:id/revoke', recent, validate(idBody.object({ reason: idBody.string().max(200).optional() })), adm.revoke);
d.get('/plans', adm.plans.list); d.post('/plans', validate(S.planBody), adm.plans.create);
d.put('/plans/:id', validate(S.planBody), adm.plans.update); d.post('/plans/:id/archive', recent, adm.plans.archive);
d.get('/discounts', adm.discounts.list); d.post('/discounts', validate(S.discountBody), adm.discounts.create); d.put('/discounts/:id', validate(S.discountBody), adm.discounts.update); d.delete('/discounts/:id', recent, adm.discounts.remove);
d.get('/mfs', adm.mfs.list); d.post('/mfs', recent, validate(S.mfsBody), adm.mfs.create); d.put('/mfs/:id', recent, validate(S.mfsBody), adm.mfs.update); d.delete('/mfs/:id', recent, adm.mfs.remove);
d.post('/mfs/reorder', recent, validate(idBody.object({ ids: idBody.array(require('../validators/schemas').oid).max(50) })), adm.mfs.reorder);
d.get('/faq', adm.faq.list); d.post('/faq', validate(S.faqBody), adm.faq.create); d.put('/faq/:id', validate(S.faqBody), adm.faq.update); d.delete('/faq/:id', adm.faq.remove);
d.get('/payments/ssl', validate(S.page, 'query'), adm.sslPayments); d.get('/payments/manual', validate(S.page, 'query'), adm.manualPayments);
d.post('/payments/manual/:id/review', recent, validate(idBody.object({ approve: idBody.boolean(), note: idBody.string().max(300).optional() })), adm.reviewManual);
d.get('/gateways', adm.gateways); d.put('/gateways/:key', recent, validate(idBody.object({ enabled: idBody.boolean() })), (req, res, next) => ['SSLCOMMERZ', 'MFS'].includes(req.params.key) ? next() : res.status(400).json({ error: 'Unknown gateway' }), adm.setGateway);
d.get('/settings', adm.getSettings);
d.put('/settings/:group', recent, (req, res, next) => { const s = S.settingsGroup[req.params.group]; if (!s) return res.status(404).json({ error: 'Unknown settings group' }); return validate(s)(req, res, next); }, adm.putSettings);
for (const [p, ctl] of [['bugs', adm.bugs], ['contacts', adm.contacts], ['tickets', adm.tickets]]) { d.get(`/${p}`, validate(S.page, 'query'), ctl.list); d.get(`/${p}/:id`, ctl.get); d.post(`/${p}/:id/reply`, validate(S.reply), ctl.reply); d.put(`/${p}/:id/status`, validate(idBody.object({ status: idBody.string().max(20) })), ctl.update); }
d.post('/payments/ssl/:id/refund', recent, validate(S.refund), adm.refundSsl);
d.post('/payments/manual/:id/refund', recent, validate(S.refund), adm.refundManual);
d.post('/reauth/request', limits.otp, adm.reauthRequest); d.post('/reauth/confirm', limits.otp, validate(S.reauth), adm.reauthConfirm);
d.get('/version', adm.version); d.put('/bugs/:id/assign', validate(S.assign), adm.assignBug);
d.get('/audit', validate(S.page, 'query'), adm.audit);
r.use('/admin', d);
module.exports = r;
