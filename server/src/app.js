const express = require("express");
const cookieParser = require("cookie-parser");
const sec = require("./middleware/security");
const {
  maintenance,
  versionGate,
  notFound,
  errorHandler,
} = require("./middleware/common");
const env = require("./config/env");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (env.prod || process.env.TRUST_PROXY) app.set("trust proxy", 1); // needed behind a reverse proxy so rate limits see real IPs
  // Behind a reverse proxy (nginx, Cloudflare...) every request would otherwise appear to come from the proxy, so users' IPs would all look the same.
  let warned = false;
  app.use((req, _res, next) => {
    if (!warned && !process.env.TRUST_PROXY && req.headers["x-forwarded-for"]) {
      warned = true;
      console.warn(
        "[config] Requests carry X-Forwarded-For but TRUST_PROXY is not set, so users will all show the proxy IP. Set TRUST_PROXY=1 (the number of proxies in front of this server).",
      );
    }
    next();
  });
  app.use(sec.helmet, sec.cors, sec.limits.general);
  app.use("/api/bugs", express.json({ limit: "1mb" })); // screenshots: validated again in the controller
  app.use(express.json({ limit: "100kb" }), cookieParser());
  app.get("/health", (_req, res) =>
    res.json({ ok: true, version: env.appVersion }),
  );
  app.use(maintenance, versionGate);
  app.use("/api", require("./routes"));
  app.use(notFound, errorHandler);
  return app;
}
module.exports = { createApp };
