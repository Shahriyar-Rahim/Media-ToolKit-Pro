const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const { SubscriptionPlan, FAQ, BugReport, ContactMessage } = require('../models');
const settings = require('../services/settings');
const checkout = require('../services/checkout');
const email = require('../services/email');
const env = require('../config/env');
const { checkScreenshot } = require('../utils/identity');
const { bad } = require('../utils/errors');
const id = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

exports.status = asyncHandler(async (_req, res) => { const a = await settings.get('app'); res.json({ appName: a.appName, maintenance: a.maintenanceMode, supportEmail: a.supportEmail, serverVersion: env.appVersion, minDesktopVersion: env.minDesktopVersion }); });
exports.plans = asyncHandler(async (_req, res) => res.json({ plans: await SubscriptionPlan.find({ active: true, visible: true, archivedAt: null }).sort({ sortOrder: 1 }).select('-__v').lean() }));
exports.methods = asyncHandler(async (_req, res) => res.json(await checkout.gatewayState()));
exports.faq = asyncHandler(async (_req, res) => res.json({ faq: await FAQ.find({ published: true }).sort({ category: 1, sortOrder: 1 }).lean() }));
exports.contact = asyncHandler(async (req, res) => {
  const m = await ContactMessage.create({ ...req.body, ticketId: id('CT') });
  await email.safe(email.send('contactReceived', m.email, { ticketId: m.ticketId })); res.status(201).json({ ticketId: m.ticketId });
});
exports.bug = asyncHandler(async (req, res) => {
  if (req.body.screenshot) { const why = checkScreenshot(req.body.screenshot); if (why) throw bad(why, 'BAD_SCREENSHOT'); }
  const b = await BugReport.create({ ...req.body, hasScreenshot: !!req.body.screenshot, reportId: id('BUG'), userId: req.user && req.user._id, email: req.user && req.user.email });
  if (req.user) await email.safe(email.send('bugReceived', req.user.email, { reportId: b.reportId })); res.status(201).json({ reportId: b.reportId });
});
