const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { User } = require('../models');
const { unauth, forbid } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const COOKIE = { httpOnly: true, sameSite: 'strict', secure: env.prod, path: '/' };
const setSession = (res, { access, refresh }) => { res.cookie('mtp_at', access, { ...COOKIE, maxAge: 15 * 60000 }); res.cookie('mtp_rt', refresh, { ...COOKIE, path: '/api/auth', maxAge: 30 * 864e5 }); };
const clearSession = (res) => { res.clearCookie('mtp_at', COOKIE); res.clearCookie('mtp_rt', { ...COOKIE, path: '/api/auth' }); };

// Role and account state always come from the database, never from the token or the client.
const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = req.cookies.mtp_at; if (!token) throw unauth();
  let p; try { p = jwt.verify(token, env.jwtAccessSecret); } catch { throw unauth('Session expired'); }
  const user = await User.findById(p.sub); if (!user || user.disabledAt) throw unauth();
  if ((user.passwordChangedAt ? +user.passwordChangedAt : 0) !== p.pca) throw unauth('Session expired');
  req.user = user; next();
});
const requireVerified = (req, _res, next) => req.user.emailVerifiedAt ? next() : next(forbid('Verify your email first'));
const requireAdmin = [requireAuth, (req, _res, next) => ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role) && req.user.emailVerifiedAt ? next() : next(forbid('Admin access required'))];
const requireSuper = [requireAuth, (req, _res, next) => req.user.role === 'SUPER_ADMIN' ? next() : next(forbid('Super admin access required'))];
module.exports = { requireAuth, requireVerified, requireAdmin, requireSuper, setSession, clearSession };
