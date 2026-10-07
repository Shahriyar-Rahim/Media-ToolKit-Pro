const { AuditLog } = require('../models');
const { clientIp } = require('../utils/identity');
const SECRET = /pass|secret|token|hash|key|otp/i;
const scrub = (o) => o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, SECRET.test(k) ? '[redacted]' : scrub(v)])) : o;
module.exports = { audit: (req, action, targetType, targetId, meta) => AuditLog.create({ actorId: req && req.user && req.user._id, action, targetType, targetId: targetId && String(targetId), meta: scrub(meta), ip: req && clientIp(req) }).catch(() => {}), scrub };
