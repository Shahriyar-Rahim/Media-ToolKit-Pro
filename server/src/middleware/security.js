const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const corsMw = cors({
  origin: (origin, cb) => { // no Origin = server-to-server / Electron main process; browsers must be allow-listed
    if (!origin) return cb(null, true);
    const allowed = [env.frontendUrl, ...env.corsOrigins];
    cb(null, allowed.includes(origin) || (!env.prod && /^http:\/\/localhost:\d+$/.test(origin)));
  }, credentials: true,
});
const limiter = (windowMin, max, message = 'Too many requests. Please slow down.') => rateLimit({ windowMs: windowMin * 60000, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: message, code: 'RATE_LIMITED' } });
const limits = { auth: limiter(15, 20), login: limiter(15, 10), otp: limiter(15, 10), reset: limiter(60, 5), payment: limiter(10, 15), manual: limiter(60, 10), contact: limiter(60, 8), bug: limiter(60, 10), admin: limiter(15, 300), general: limiter(1, 240) };
module.exports = { helmet: helmet(), cors: corsMw, limits };
