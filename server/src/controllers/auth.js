const asyncHandler = require('../utils/asyncHandler');
const auth = require('../services/auth');
const { setSession, clearSession } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { clientIp } = require('../utils/identity');
const pub = (u) => ({ id: u._id, email: u.email, name: u.name, role: u.role, emailVerified: !!u.emailVerifiedAt, twoFactorEnabled: u.twoFactorEnabled });
// NOTE: audit() gets a small object with the ip, because spreading `req` would lose its ip getter.
const begin = async (req, res, user) => { const ip = clientIp(req); const s = await auth.startSession(user, { ua: req.get('user-agent'), ip }); setSession(res, s); if (user.role !== 'CUSTOMER') await audit({ user, ip }, 'admin.login', 'User', user._id); return res.json({ user: pub(user) }); };

exports.register = asyncHandler(async (req, res) => { await auth.register(req.body); res.status(201).json({ ok: true, message: 'If this email can be registered, a verification code was sent.' }); });
exports.verifyEmail = asyncHandler(async (req, res) => { const u = await auth.verifyEmail(req.body.email, req.body.code); res.json({ ok: true, verified: !!u.emailVerifiedAt }); });
exports.resendVerification = asyncHandler(async (req, res) => { const { User } = require('../models'); const u = await User.findOne({ email: req.body.email }); if (u && !u.emailVerifiedAt) await auth.issueOtp(u, 'VERIFY_EMAIL').catch((e) => { if (e.code === 'OTP_COOLDOWN') throw e; }); res.json({ ok: true }); });
exports.login = asyncHandler(async (req, res) => { const r = await auth.login({ ...req.body, ip: clientIp(req) }); if (r.otpRequired) return res.json({ otpRequired: true }); return begin(req, res, r.user); });
exports.loginOtp = asyncHandler(async (req, res) => begin(req, res, await auth.completeLoginOtp(req.body.email, req.body.code)));
exports.refresh = asyncHandler(async (req, res) => { const r = await auth.refresh(req.cookies.mtp_rt, { ua: req.get('user-agent'), ip: clientIp(req) }); setSession(res, r); res.json({ user: pub(r.user) }); });
exports.logout = asyncHandler(async (req, res) => { await auth.endSession(req.cookies.mtp_rt); clearSession(res); res.json({ ok: true }); });
exports.forgot = asyncHandler(async (req, res) => res.json(await auth.forgotPassword(req.body.email)));
exports.reset = asyncHandler(async (req, res) => { await auth.resetPassword(req.body.email, req.body.code, req.body.password); res.json({ ok: true }); });
exports.changePassword = asyncHandler(async (req, res) => { await auth.changePassword(req.user, req.body.currentPassword, req.body.newPassword); clearSession(res); res.json({ ok: true, message: 'Password changed. Please sign in again.' }); });
exports.me = (req, res) => res.json({ user: pub(req.user) });
exports.toggle2fa = asyncHandler(async (req, res) => { req.user.twoFactorEnabled = !!req.body.enabled; await req.user.save(); res.json({ user: pub(req.user) }); });
