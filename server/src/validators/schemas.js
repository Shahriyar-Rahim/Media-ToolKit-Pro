const { z } = require('zod');
const { FEATURES } = require('../config/constants');
const oid = z.string().regex(/^[a-f\d]{24}$/i, 'invalid id');
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10, 'at least 10 characters').max(128).refine((p) => /[a-z]/i.test(p) && /\d/.test(p), 'use letters and numbers');
const otp = z.string().regex(/^\d{6}$/, '6 digits');
const money = z.number().int().min(0).max(100000000);
const page = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), q: z.string().max(100).optional(), status: z.string().max(30).optional(), sort: z.string().max(30).optional() });

const featureFlags = z.object(Object.fromEntries(FEATURES.map((f) => [f, z.boolean().optional()]))).strict();
const limit = z.number().int().min(0).nullable().optional();
const planBody = z.object({
  name: z.string().trim().min(1).max(60), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(40), description: z.string().max(500).optional(),
  priceMinor: money, currency: z.string().length(3).toUpperCase().default('BDT'), isLifetime: z.boolean().default(false), billingPeriodDays: z.number().int().min(1).max(3660).optional(),
  entitlements: z.object({ features: featureFlags.default({}), limits: z.object({ dailyJobs: limit, monthlyJobs: limit, maxFileSizeMB: limit }).default({}) }).default({}),
  expectedUpdatedAt: z.string().optional(), rank: z.number().int().min(0).max(1000).default(0), active: z.boolean().default(true), visible: z.boolean().default(true), sortOrder: z.number().int().default(0), oneTimePerUser: z.boolean().default(false),
}).refine((p) => p.isLifetime || p.billingPeriodDays, { message: 'billingPeriodDays is required unless the plan is lifetime', path: ['billingPeriodDays'] })
  .transform(({ ...p }) => { if (p.isLifetime) delete p.billingPeriodDays; return p; });

const discountBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/), type: z.enum(['PERCENT', 'FIXED']), value: z.number().min(0), enabled: z.boolean().default(true),
  startsAt: z.coerce.date().optional().nullable(), endsAt: z.coerce.date().optional().nullable(), planIds: z.array(oid).default([]), maxRedemptions: z.number().int().min(1).optional().nullable(), perUserLimit: z.number().int().min(1).default(1),
}).refine((d) => d.type !== 'PERCENT' || (d.value > 0 && d.value <= 100), { message: 'percentage must be between 0 and 100', path: ['value'] })
  .refine((d) => d.type !== 'FIXED' || Number.isInteger(d.value), { message: 'fixed amount must be whole minor units', path: ['value'] })
  .refine((d) => !d.startsAt || !d.endsAt || d.endsAt > d.startsAt, { message: 'end must be after start', path: ['endsAt'] });

const S = {
  register: z.object({ email, password, confirmPassword: z.string(), name: z.string().trim().max(80).optional() }).refine((d) => d.password === d.confirmPassword, { message: 'passwords do not match', path: ['confirmPassword'] }).transform(({ confirmPassword, ...r }) => r),
  login: z.object({ email, password: z.string().min(1).max(128) }),
  otpVerify: z.object({ email, code: otp }),
  emailOnly: z.object({ email }),
  reset: z.object({ email, code: otp, password }),
  changePassword: z.object({ currentPassword: z.string().min(1), newPassword: password }),
  checkout: z.object({ planId: oid, discountCode: z.string().trim().max(30).optional(), method: z.enum(['SSLCOMMERZ', 'MFS']).optional(), providerId: oid.optional() }),
  quote: z.object({ planId: oid, discountCode: z.string().trim().max(30).optional() }),
  manualPayment: z.object({ planId: oid, providerId: oid, discountCode: z.string().trim().max(30).optional(), transactionId: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9-]+$/), senderNumber: z.string().trim().regex(/^\+?\d{8,15}$/), amount: z.number().positive().max(1000000), note: z.string().max(300).optional() }),
  consume: z.object({ feature: z.enum(FEATURES), also: z.array(z.enum(FEATURES)).max(5).default([]), clientJobId: z.string().min(8).max(64), fileSizeBytes: z.number().int().min(0).default(0) }),
  bug: z.object({ title: z.string().trim().min(3).max(140), description: z.string().trim().min(10).max(5000), category: z.string().max(40).default('GENERAL'), severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    screenshot: z.string().max(900000).optional(), steps: z.string().max(3000).optional(), expected: z.string().max(1000).optional(), actual: z.string().max(1000).optional(), appVersion: z.string().max(30).optional(), os: z.string().max(80).optional(), logExcerpt: z.string().max(20000).optional() }),
  contact: z.object({ name: z.string().trim().min(1).max(80), email, subject: z.string().trim().min(3).max(140), message: z.string().trim().min(10).max(4000) }),
  refund: z.object({ reason: z.string().trim().min(3).max(200), viaGateway: z.boolean().default(true) }),
  reauth: z.object({ code: otp }),
  resetAccess: z.object({ forcePasswordReset: z.boolean().default(false) }),
  assign: z.object({ assignedTo: oid.nullable() }),
  reply: z.object({ message: z.string().trim().min(1).max(4000), status: z.string().max(20).optional() }),
  planBody, discountBody, page,
  mfsBody: z.object({ name: z.string().trim().min(2).max(40), accountNumber: z.string().trim().regex(/^\+?\d{8,15}$/, 'invalid account number'), accountType: z.enum(['PERSONAL', 'AGENT', 'MERCHANT']).default('PERSONAL'), instructions: z.string().max(1000).optional(), enabled: z.boolean().default(true), sortOrder: z.number().int().default(0) }),
  faqBody: z.object({ category: z.string().max(40).default('general'), question: z.string().trim().min(3).max(300), answer: z.string().trim().min(3).max(4000), published: z.boolean().default(true), sortOrder: z.number().int().default(0) }),
  settingsGroup: {
    app: z.object({ appName: z.string().min(1).max(60), supportEmail: email, contactEmail: email, currency: z.string().length(3).toUpperCase(), timezone: z.string().max(60), maintenanceMode: z.boolean(), minDesktopVersion: z.string().regex(/^\d+\.\d+\.\d+$/) }).partial(),
    security: z.object({ otpExpiryMinutes: z.number().int().min(1).max(30), otpResendSeconds: z.number().int().min(10).max(600), otpMaxAttempts: z.number().int().min(3).max(10), loginOtpRequired: z.boolean(), adminTwoFactorRequired: z.boolean(), maxFailedLogins: z.number().int().min(3).max(20), lockMinutes: z.number().int().min(1).max(1440), adminReauthRequired: z.boolean(), adminReauthMinutes: z.number().int().min(1).max(120), blockedEmailDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(500) }).partial(),
    freeAccess: z.object({ enabled: z.boolean(), trialDays: z.number().int().min(0).max(365).nullable(), operationCount: z.number().int().min(0).nullable(), dailyLimit: z.number().int().min(0).nullable(), monthlyLimit: z.number().int().min(0).nullable(), allowedFeatures: z.array(z.enum(FEATURES)), maxFileSizeMB: z.number().int().min(1).nullable() }).partial(),
    subscription: z.object({ expiryReminderDays: z.number().int().min(1).max(60) }).partial(),
  },
};
module.exports = { S, oid };
