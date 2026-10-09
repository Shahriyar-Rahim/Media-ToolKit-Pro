const crypto = require("crypto");
const env = require("../config/env");
const generateCode = () =>
  String(crypto.randomInt(0, 1000000)).padStart(6, "0"); // CSPRNG, uniform
const hashCode = (userId, purpose, code) =>
  crypto
    .createHmac("sha256", env.otpSecret)
    .update(`${userId}:${purpose}:${code}`)
    .digest("hex");
const safeEqual = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
// Pure decision function so every branch is unit-testable.
function evaluate(otp, userId, purpose, code, now = new Date()) {
  if (!otp || otp.consumedAt) return "INVALID";
  if (otp.expiresAt <= now) return "EXPIRED";
  if (otp.attempts >= otp.maxAttempts) return "LOCKED";
  return safeEqual(otp.codeHash, hashCode(userId, purpose, code))
    ? "OK"
    : "WRONG";
}
module.exports = { generateCode, hashCode, evaluate };
