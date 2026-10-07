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
  if (env.prod || process.env.TRUST_PROXY)
    app.set("trust proxy", 1);
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
