class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const bad = (m, c) => new HttpError(400, m, c), unauth = (m = 'Authentication required') => new HttpError(401, m, 'UNAUTHENTICATED'),
  forbid = (m = 'Not allowed') => new HttpError(403, m, 'FORBIDDEN'), missing = (m = 'Not found') => new HttpError(404, m, 'NOT_FOUND'), conflict = (m, c) => new HttpError(409, m, c);
module.exports = { HttpError, bad, unauth, forbid, missing, conflict };
