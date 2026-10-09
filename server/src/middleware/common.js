const { ZodError } = require("zod");
const { HttpError } = require("../utils/errors");
const settings = require("../services/settings");
const env = require("../config/env");
const { cmpVersion } = require("../utils/identity");

const validate =
  (schema, where = "body") =>
  (req, _res, next) => {
    const r = schema.safeParse(req[where]);
    if (!r.success)
      return next(
        new HttpError(
          400,
          r.error.issues
            .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
            .join("; "),
          "VALIDATION",
        ),
      );
    req[where] = r.data;
    next(); // handlers only ever see parsed, stripped data
  };
// Maintenance: online features return 503; health, status and admin routes stay reachable so admins can turn it off.
const maintenance = async (req, res, next) => {
  const open = [
    "/health",
    "/api/app/status",
    "/api/auth/login",
    "/api/auth/login/otp",
    "/api/auth/refresh",
    "/api/auth/logout",
  ];
  if (
    open.includes(req.path) ||
    req.path.startsWith("/api/admin") ||
    req.path.startsWith("/api/payments/sslcommerz")
  )
    return next();
  if ((await settings.get("app")).maintenanceMode)
    return res.status(503).json({
      error: "Service temporarily unavailable.",
      code: "MAINTENANCE",
      offlineToolsAvailable: true,
    });
  next();
};
// Only desktop builds that announce a version can be told to update; admin, auth and status endpoints stay reachable.
const versionGate = async (req, res, next) => {
  const v = req.get("x-client-version");
  if (
    !v ||
    !/^\d+\.\d+\.\d+$/.test(v) ||
    req.path.startsWith("/api/admin") ||
    req.path.startsWith("/api/auth") ||
    req.path === "/api/app/status" ||
    req.path === "/health"
  )
    return next();
  const min = (await settings.get("app")).minDesktopVersion;
  if (min && cmpVersion(v, min) < 0)
    return res.status(426).json({
      error: `Please update Media Toolkit Pro to version ${min} or newer to use online features. Local tools still work.`,
      code: "UPGRADE_REQUIRED",
      minVersion: min,
    });
  next();
};
const notFound = (_req, res) => res.status(404).json({ error: "Not found" });
const errorHandler = (err, req, res, _next) => {
  if (err instanceof HttpError)
    return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof ZodError)
    return res.status(400).json({ error: "Invalid input", code: "VALIDATION" });
  if (err.type === "entity.too.large")
    return res.status(413).json({ error: "Request too large" });
  if (err.name === "CastError")
    return res.status(400).json({ error: "Invalid id" });
  console.error("[server error]", req.method, req.path, err); // stack stays in server logs; users get a generic message
  res.status(500).json({
    error: "Something went wrong. Please try again.",
    code: "INTERNAL",
  });
};
module.exports = { validate, maintenance, versionGate, notFound, errorHandler };
