const { ApplicationSetting } = require('../models');
// Every business rule the admin controls lives here as data. Defaults only apply until an admin saves a value.
const DEFAULTS = {
  app: { appName: 'Media Toolkit Pro', supportEmail: 'support@example.com', contactEmail: 'contact@example.com', currency: 'BDT', timezone: 'Asia/Dhaka', maintenanceMode: false, minDesktopVersion: '0.1.0' },
  security: { otpExpiryMinutes: 5, otpResendSeconds: 60, otpMaxAttempts: 5, loginOtpRequired: false, adminTwoFactorRequired: true, maxFailedLogins: 8, lockMinutes: 15, adminReauthRequired: true, adminReauthMinutes: 15, blockedEmailDomains: [] },
  freeAccess: { enabled: true, trialDays: 7, operationCount: 10, dailyLimit: 5, monthlyLimit: 10, allowedFeatures: ['videoCompression', 'audioConversion', 'heicConversion', 'pdfCreate', 'pdfMerge', 'mediaVault'], maxFileSizeMB: 500 },
  subscription: { expiryReminderDays: 3 },
};
const cache = new Map();
async function get(key) {
  const hit = cache.get(key); if (hit && hit.exp > Date.now()) return hit.v;
  const row = await ApplicationSetting.findOne({ key }).lean();
  const v = { ...DEFAULTS[key], ...(row ? row.value : {}) };
  cache.set(key, { v, exp: Date.now() + 5000 }); return v; // short TTL: admin edits take effect within seconds
}
async function set(key, value, actorId) {
  if (!DEFAULTS[key]) throw new Error('Unknown settings group');
  await ApplicationSetting.findOneAndUpdate({ key }, { value, updatedBy: actorId }, { upsert: true }); cache.delete(key); return get(key);
}
module.exports = { get, set, DEFAULTS, clear: () => cache.clear() };
