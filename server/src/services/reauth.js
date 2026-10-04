const { User } = require('../models');
const auth = require('./auth');
const settings = require('./settings');
const { HttpError } = require('../utils/errors');

// "Recent confirmation" for sensitive admin actions: an emailed code, valid for a short window.
const request = (user) => auth.issueOtp(user, 'SENSITIVE');
async function confirm(user, code) {
  await auth.consumeOtp(user, 'SENSITIVE', code);
  const m = (await settings.get('security')).adminReauthMinutes; const until = new Date(Date.now() + m * 60000);
  await User.updateOne({ _id: user._id }, { reauthUntil: until }); return until;
}
async function required(req, _res, next) {
  try {
    if (!(await settings.get('security')).adminReauthRequired) return next();
    if (req.user.reauthUntil && req.user.reauthUntil > new Date()) return next();
    next(new HttpError(403, 'Please confirm it is you with an emailed code to continue.', 'REAUTH_REQUIRED'));
  } catch (e) { next(e); }
}
module.exports = { request, confirm, required };
