require("dotenv").config();
const { loadKeys } = require("./keys");
const prod = process.env.NODE_ENV === "production";
const keys = loadKeys(process.env);
for (const p of keys.problems)
  console.warn(
    `[config] ${p} Offline access for desktop users is disabled until this is fixed (run: npm run keys).`,
  );
const need = (k) => {
  const v = process.env[k];
  if (!v && prod) throw new Error(`Missing env ${k}`);
  return v;
};
module.exports = {
  prod,
  port: +process.env.PORT || 4000,
  mongoUri:
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/media_toolkit_pro",
  publicApiUrl: process.env.PUBLIC_API_URL || "http://localhost:4000",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  jwtAccessSecret: need("JWT_ACCESS_SECRET") || "dev-only-access-secret",
  otpSecret: need("OTP_HMAC_SECRET") || "dev-only-otp-secret",
  entitlementPrivateKey: keys.privateKey,
  entitlementPublicKey: keys.publicKey,
  smtp: {
    host: process.env.SMTP_HOST,
    port: +process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM || "Media Toolkit Pro <no-reply@localhost>",
  },
  ssl: {
    storeId: process.env.SSLCOMMERZ_STORE_ID,
    storePass: process.env.SSLCOMMERZ_STORE_PASSWORD,
    sandbox: process.env.SSLCOMMERZ_IS_SANDBOX !== "false",
  },
  appVersion: "0.1.0",
  minDesktopVersion: "0.1.0",
};
