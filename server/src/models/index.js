const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const { FEATURES, ROLES, SUB_STATUS } = require('../config/constants');
const oid = (ref) => ({ type: Schema.Types.ObjectId, ref });
const T = { timestamps: true };

const User = model('User', new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  name: { type: String, trim: true, maxlength: 80 },
  role: { type: String, enum: ROLES, default: 'CUSTOMER', index: true },
  emailVerifiedAt: Date,
  disabledAt: Date,
  twoFactorEnabled: { type: Boolean, default: false },
  emailCanonical: { type: String, index: true }, reauthUntil: Date, mustResetPassword: { type: Boolean, default: false },
  failedLogins: { type: Number, default: 0 }, lockUntil: Date,
  lastLoginAt: Date, lastLoginIp: String, lastSeenAt: Date, lastSeenIp: String, passwordChangedAt: Date,
  sessions: { type: [{ tokenHash: String, expiresAt: Date, ua: String, ip: String, createdAt: Date }], select: false },
  freeTrialStartedAt: Date, // set at email verification
}, T));

const Otp = model('Otp', new Schema({
  userId: { ...oid('User'), index: true }, purpose: { type: String, enum: ['VERIFY_EMAIL', 'LOGIN', 'RESET_PASSWORD', 'SENSITIVE'], required: true },
  codeHash: { type: String, required: true }, attempts: { type: Number, default: 0 }, maxAttempts: { type: Number, default: 5 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }, consumedAt: Date, resendAfter: Date,
}, T));

const featureShape = Object.fromEntries(FEATURES.map((f) => [f, { type: Boolean, default: false }]));
const entitlementShape = { features: featureShape, limits: { dailyJobs: Number, monthlyJobs: Number, maxFileSizeMB: Number } }; // undefined limit = unlimited

const SubscriptionPlan = model('SubscriptionPlan', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 }, slug: { type: String, required: true, unique: true, lowercase: true },
  description: { type: String, maxlength: 500 },
  priceMinor: { type: Number, required: true, min: 0, validate: Number.isInteger }, // 0 is valid = free plan
  currency: { type: String, default: 'BDT', uppercase: true },
  isLifetime: { type: Boolean, default: false }, billingPeriodDays: { type: Number, min: 1 }, // required unless lifetime (validated in zod)
  entitlements: entitlementShape, rank: { type: Number, default: 0 }, // higher rank = stronger entitlement
  active: { type: Boolean, default: true }, visible: { type: Boolean, default: true }, archivedAt: Date,
  sortOrder: { type: Number, default: 0 }, oneTimePerUser: { type: Boolean, default: false },
}, T));

const Subscription = model('Subscription', new Schema({
  userId: { ...oid('User'), required: true, index: true }, planId: { ...oid('SubscriptionPlan'), required: true },
  planSnapshot: Schema.Types.Mixed, // entitlements + name frozen at purchase, so later plan edits/archival don't rewrite history
  status: { type: String, enum: SUB_STATUS, default: 'PENDING', index: true },
  startsAt: Date, endsAt: Date, isLifetime: { type: Boolean, default: false },
  paymentKey: { type: String, unique: true, sparse: true }, orderId: String, // "ssl:<tranId>" | "mfs:<id>" | "grant:<id>" - enforces idempotent activation
  paymentMethod: { type: String, enum: ['SSLCOMMERZ', 'MFS', 'FREE', 'ADMIN_GRANT'] },
  originalPriceMinor: Number, discountMinor: { type: Number, default: 0 }, finalPriceMinor: Number, currency: String,
  discountId: oid('Discount'), revokedAt: Date, revokedReason: String, grantedBy: oid('User'),
}, T));
Subscription.schema.index({ userId: 1, status: 1, endsAt: 1 });

const Discount = model('Discount', new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true }, name: { type: String, trim: true, maxlength: 60 },
  type: { type: String, enum: ['PERCENT', 'FIXED'], required: true }, value: { type: Number, required: true, min: 0 }, // PERCENT: 0-100, FIXED: minor units
  enabled: { type: Boolean, default: true }, startsAt: Date, endsAt: Date, planIds: [oid('SubscriptionPlan')], // empty = all plans
  maxRedemptions: Number, perUserLimit: { type: Number, default: 1 }, redeemedCount: { type: Number, default: 0 },
}, T));

const Payment = model('Payment', new Schema({ // SSLCommerz
  userId: { ...oid('User'), required: true, index: true }, planId: oid('SubscriptionPlan'), discountId: oid('Discount'),
  tranId: { type: String, required: true, unique: true }, orderId: { type: String, unique: true, sparse: true }, amountMinor: { type: Number, required: true }, currency: { type: String, required: true },
  originalPriceMinor: Number, discountMinor: Number,
  status: { type: String, enum: ['INITIATED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDING', 'REFUNDED'], default: 'INITIATED', index: true },
  refundedAt: Date, refundedBy: oid('User'), refundReason: String, refundRef: String, refundSentAt: Date, refundLockUntil: Date, refundGatewayStatus: String, refundError: String, discountReleasedAt: Date,
  expiresAt: Date, gatewayUrl: String, valId: String, bankTranId: String, gatewayStatus: String, validation: Schema.Types.Mixed,
  subscriptionId: oid('Subscription'), paidAt: Date, receiptEmailedAt: Date, callbackCount: { type: Number, default: 0 },
}, T));

const MFSProvider = model('MFSProvider', new Schema({
  name: { type: String, required: true, trim: true, unique: true }, accountNumber: { type: String, required: true },
  accountType: { type: String, enum: ['PERSONAL', 'AGENT', 'MERCHANT'], default: 'PERSONAL' }, instructions: { type: String, maxlength: 1000 },
  enabled: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 },
}, T));

const ManualPayment = model('ManualPayment', new Schema({
  userId: { ...oid('User'), required: true, index: true }, planId: { ...oid('SubscriptionPlan'), required: true }, providerId: { ...oid('MFSProvider'), required: true },
  discountId: oid('Discount'), orderId: { type: String, unique: true, sparse: true }, transactionId: { type: String, required: true, trim: true, uppercase: true }, senderNumber: { type: String, required: true },
  amountMinor: { type: Number, required: true }, expectedMinor: { type: Number, required: true }, currency: String, originalPriceMinor: Number, discountMinor: Number,
  note: { type: String, maxlength: 300 }, status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'REFUNDED'], default: 'PENDING', index: true },
  refundedAt: Date, refundedBy: oid('User'), refundReason: String, discountReleasedAt: Date,
  submittedAt: { type: Date, default: Date.now }, reviewedAt: Date, reviewedBy: oid('User'), adminNote: String, subscriptionId: oid('Subscription'),
}, T));
ManualPayment.schema.index({ providerId: 1, transactionId: 1 }, { unique: true }); // same MFS txn id can never be submitted twice

const PaymentGatewayConfig = model('PaymentGatewayConfig', new Schema({
  key: { type: String, enum: ['SSLCOMMERZ', 'MFS'], unique: true }, enabled: { type: Boolean, default: false }, updatedBy: oid('User'),
}, T)); // credentials never live here - env only

const UsageRecord = model('UsageRecord', new Schema({
  userId: { ...oid('User'), required: true }, feature: { type: String, enum: FEATURES, required: true }, clientJobId: { type: String, required: true },
  source: { type: String, enum: ['SUBSCRIPTION', 'FREE'], required: true }, bytes: Number, at: { type: Date, default: Date.now },
}, { timestamps: false }));
UsageRecord.schema.index({ userId: 1, clientJobId: 1 }, { unique: true }); // retries never double-count
UsageRecord.schema.index({ userId: 1, at: -1 });

const BugReport = model('BugReport', new Schema({
  reportId: { type: String, unique: true }, userId: oid('User'), email: String, title: { type: String, required: true, maxlength: 140 }, description: { type: String, required: true, maxlength: 5000 },
  category: { type: String, default: 'GENERAL' }, severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
  steps: String, expected: String, actual: String, appVersion: String, os: String, screenshot: { type: String, select: false }, hasScreenshot: Boolean, logExcerpt: { type: String, maxlength: 20000 },
  status: { type: String, enum: ['OPEN', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'], default: 'OPEN', index: true }, assignedTo: oid('User'),
  replies: [{ by: oid('User'), message: String, at: Date }],
}, T));

const SupportTicket = model('SupportTicket', new Schema({
  ticketId: { type: String, unique: true }, userId: oid('User'), subject: String, message: String, status: { type: String, enum: ['OPEN', 'RESOLVED', 'ARCHIVED'], default: 'OPEN', index: true },
  replies: [{ by: oid('User'), message: String, at: Date }],
}, T));

const ContactMessage = model('ContactMessage', new Schema({
  ticketId: { type: String, unique: true }, name: { type: String, required: true, maxlength: 80 }, email: { type: String, required: true }, subject: { type: String, required: true, maxlength: 140 },
  message: { type: String, required: true, maxlength: 4000 }, status: { type: String, enum: ['OPEN', 'RESOLVED', 'ARCHIVED'], default: 'OPEN', index: true },
  replies: [{ by: oid('User'), message: String, at: Date }],
}, T));

const FAQ = model('FAQ', new Schema({
  category: { type: String, default: 'general', index: true }, question: { type: String, required: true }, answer: { type: String, required: true },
  published: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 },
}, T));

const ApplicationSetting = model('ApplicationSetting', new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed, updatedBy: oid('User') }, T));

const AuditLog = model('AuditLog', new Schema({
  actorId: oid('User'), action: { type: String, index: true }, targetType: String, targetId: String, meta: Schema.Types.Mixed, ip: String, at: { type: Date, default: Date.now, index: true },
}, { timestamps: false }));

const EmailLog = model('EmailLog', new Schema({ key: { type: String, unique: true }, to: String, template: String, sentAt: { type: Date, default: Date.now } }, { timestamps: false }));

module.exports = { User, Otp, SubscriptionPlan, Subscription, Discount, Payment, MFSProvider, ManualPayment, PaymentGatewayConfig, UsageRecord, BugReport, SupportTicket, ContactMessage, FAQ, ApplicationSetting, AuditLog, EmailLog };
