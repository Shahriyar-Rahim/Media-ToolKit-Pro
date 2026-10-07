const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../config/env");
const { User, Otp } = require("../models");
const settings = require("./settings");
const email = require("./email");
const core = require("./otpCore");
const { bad, unauth, forbid, HttpError } = require("../utils/errors");
const { canonicalEmail } = require("../utils/identity");

const COST = 12;
const hashPassword = (p) => bcrypt.hash(p, COST);
const DUMMY = bcrypt.hashSync("dummy-password-for-timing", COST); // equalises timing for unknown emails

async function issueOtp(user, purpose) {
  const s = await settings.get("security");
  const last = await Otp.findOne({
    userId: user._id,
    purpose,
    consumedAt: null,
  }).sort({ createdAt: -1 });
  if (last && last.resendAfter > new Date())
    throw new HttpError(
      429,
      `Wait ${Math.ceil((last.resendAfter - Date.now()) / 1000)}s before requesting another code`,
      "OTP_COOLDOWN",
    );
  await Otp.updateMany(
    { userId: user._id, purpose, consumedAt: null },
    { consumedAt: new Date() },
  ); // only the newest code is valid
  const code = core.generateCode();
  await Otp.create({
    userId: user._id,
    purpose,
    codeHash: core.hashCode(user._id, purpose, code),
    maxAttempts: s.otpMaxAttempts,
    expiresAt: new Date(Date.now() + s.otpExpiryMinutes * 60000),
    resendAfter: new Date(Date.now() + s.otpResendSeconds * 1000),
  });
  const tpl = {
    VERIFY_EMAIL: "verifyEmail",
    LOGIN: "loginOtp",
    RESET_PASSWORD: "passwordReset",
    SENSITIVE: "loginOtp",
  }[purpose];
  await email.send(tpl, user.email, { code, minutes: s.otpExpiryMinutes });
}

async function consumeOtp(user, purpose, code) {
  const otp = await Otp.findOne({
    userId: user._id,
    purpose,
    consumedAt: null,
  }).sort({ createdAt: -1 });
  if (otp && otp.expiresAt > new Date() && otp.attempts < otp.maxAttempts)
    await Otp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } }); // count first: no free guesses under concurrency
  const verdict = core.evaluate(otp, user._id, purpose, code);
  if (verdict !== "OK")
    throw bad(
      {
        EXPIRED: "Code expired. Request a new one.",
        LOCKED: "Too many attempts. Request a new code.",
        WRONG: "Incorrect code",
        INVALID: "Invalid or used code",
      }[verdict],
      `OTP_${verdict}`,
    );
  const r = await Otp.updateOne(
    { _id: otp._id, consumedAt: null },
    { consumedAt: new Date() },
  );
  if (r.modifiedCount !== 1) throw bad("Invalid or used code", "OTP_INVALID"); // single-use even under races
}

async function register({ email: addr, password, name }) {
  const blocked = (await settings.get("security")).blockedEmailDomains || [];
  if (blocked.includes(addr.split("@")[1]))
    throw bad("Please use a different email provider.", "EMAIL_DOMAIN_BLOCKED");
  const canon = canonicalEmail(addr);
  if (
    await User.exists({ $or: [{ email: addr }, { emailCanonical: canon }] })
  ) {
    // alias of an existing inbox: same quiet response // same response shape as success so emails can't be enumerated
    return { ok: true };
  }
  const user = await User.create({
    email: addr,
    emailCanonical: canon,
    name,
    passwordHash: await hashPassword(password),
  });
  await issueOtp(user, "VERIFY_EMAIL");
  return { ok: true };
}

async function verifyEmail(addr, code) {
  const user = await User.findOne({ email: addr });
  if (!user) throw bad("Invalid or used code", "OTP_INVALID");
  if (user.emailVerifiedAt) return user;
  await consumeOtp(user, "VERIFY_EMAIL", code);
  user.emailVerifiedAt = new Date();
  const dupTrial =
    user.emailCanonical &&
    (await User.exists({
      _id: { $ne: user._id },
      emailCanonical: user.emailCanonical,
      freeTrialStartedAt: { $ne: null },
    }));
  if (!dupTrial)
    user.freeTrialStartedAt = user.freeTrialStartedAt || new Date();
  await user.save(); // trial clock starts at verification, tied to the account, not the device
  await email.safe(
    email.sendOnce(`welcome:${user._id}`, "welcome", user.email, {
      name: user.name,
    }),
  );
  return user;
}

async function login({ email: addr, password, ip }) {
  const s = await settings.get("security");
  const user = await User.findOne({ email: addr }).select("+passwordHash");
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY);
  if (!user || (user.lockUntil && user.lockUntil > new Date()))
    throw unauth("Invalid email or password");
  if (!ok) {
    const n = user.failedLogins + 1;
    await User.updateOne(
      { _id: user._id },
      n >= s.maxFailedLogins
        ? {
            failedLogins: 0,
            lockUntil: new Date(Date.now() + s.lockMinutes * 60000),
          }
        : { failedLogins: n },
    );
    throw unauth("Invalid email or password");
  }
  if (user.disabledAt)
    throw forbid("This account is disabled. Contact support.");
  if (!user.emailVerifiedAt) {
    await issueOtp(user, "VERIFY_EMAIL").catch(() => {});
    throw new HttpError(
      403,
      "Verify your email first. We sent a new code.",
      "EMAIL_NOT_VERIFIED",
    );
  }
  if (user.mustResetPassword) {
    await issueOtp(user, "RESET_PASSWORD").catch(() => {});
    throw new HttpError(
      403,
      "Your password must be reset. We emailed you a code.",
      "PASSWORD_RESET_REQUIRED",
    );
  }
  const isAdmin = user.role !== "CUSTOMER";
  if (
    user.twoFactorEnabled ||
    s.loginOtpRequired ||
    (isAdmin && s.adminTwoFactorRequired)
  ) {
    await issueOtp(user, "LOGIN");
    return { otpRequired: true };
  }
  return { user };
}

async function completeLoginOtp(addr, code) {
  const user = await User.findOne({ email: addr });
  if (!user) throw bad("Invalid or used code", "OTP_INVALID");
  if (user.disabledAt) throw forbid("This account is disabled.");
  await consumeOtp(user, "LOGIN", code);
  return user;
}

async function forgotPassword(addr) {
  const u = await User.findOne({ email: addr });
  if (u && u.emailVerifiedAt && !u.disabledAt)
    await issueOtp(u, "RESET_PASSWORD").catch(() => {});
  return { ok: true };
}
async function resetPassword(addr, code, password) {
  const u = await User.findOne({ email: addr });
  if (!u) throw bad("Invalid or used code", "OTP_INVALID");
  await consumeOtp(u, "RESET_PASSWORD", code);
  await User.updateOne(
    { _id: u._id },
    {
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      sessions: [],
      failedLogins: 0,
      lockUntil: null,
      mustResetPassword: false,
    },
  ); // reset revokes every session
}

// ---- sessions: short-lived access JWT + rotating opaque refresh token (only its hash is stored) ----
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const signAccess = (u) =>
  jwt.sign(
    { sub: String(u._id), pca: u.passwordChangedAt ? +u.passwordChangedAt : 0 },
    env.jwtAccessSecret,
    { expiresIn: "15m" },
  );
async function startSession(user, ua, ip) {
  const refresh = crypto.randomBytes(48).toString("base64url");
  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        sessions: {
          $each: [
            {
              tokenHash: sha(refresh),
              expiresAt: new Date(Date.now() + 30 * 864e5),
              ua: (ua || "").slice(0, 200),
              createdAt: new Date(),
            },
          ],
          $slice: -10,
        },
      },
      lastLoginAt: new Date(),
      lastLoginIp: ip,
      failedLogins: 0,
    },
  );
  return { access: signAccess(user), refresh };
}
async function refresh(token) {
  if (!token) throw unauth();
  const h = sha(token);
  const user = await User.findOneAndUpdate(
    { "sessions.tokenHash": h, "sessions.expiresAt": { $gt: new Date() } },
    { $pull: { sessions: { tokenHash: h } } },
  ); // rotate: old token dies immediately (replay = fail)
  if (!user || user.disabledAt) throw unauth("Session expired");
  return { user, ...(await startSession(user)) };
}
const endSession = (token) =>
  token
    ? User.updateOne(
        { "sessions.tokenHash": sha(token) },
        { $pull: { sessions: { tokenHash: sha(token) } } },
      )
    : null;
async function changePassword(user, current, next) {
  const u = await User.findById(user._id).select("+passwordHash");
  if (!(await bcrypt.compare(current, u.passwordHash)))
    throw bad("Current password is incorrect");
  await User.updateOne(
    { _id: u._id },
    {
      passwordHash: await hashPassword(next),
      passwordChangedAt: new Date(),
      sessions: [],
    },
  );
}
module.exports = {
  register,
  verifyEmail,
  login,
  completeLoginOtp,
  forgotPassword,
  resetPassword,
  startSession,
  refresh,
  endSession,
  changePassword,
  issueOtp,
  consumeOtp,
  hashPassword,
  signAccess,
};
