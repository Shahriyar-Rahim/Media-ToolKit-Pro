const asyncHandler = require('../utils/asyncHandler');
const { Subscription, Payment, ManualPayment, BugReport } = require('../models');
const usage = require('../services/usage');
const ent = require('../services/entitlement');
const subsSvc = require('../services/subscriptions');
const settings = require('../services/settings');

exports.entitlement = asyncHandler(async (req, res) => {
  await subsSvc.expireDue(); const e = await usage.current(req.user);
  res.json({ entitlement: { ...e, remaining: ent.remaining(e) }, snapshot: ent.signSnapshot(req.user._id, e), serverTime: new Date() });
});
exports.consume = asyncHandler(async (req, res) => res.json(await usage.consume(req.user, req.body)));
exports.subscriptions = asyncHandler(async (req, res) => res.json({ subscriptions: await Subscription.find({ userId: req.user._id }).sort({ createdAt: -1 }).select('-paymentKey').lean() }));
exports.payments = asyncHandler(async (req, res) => {
  const [ssl, manual] = await Promise.all([Payment.find({ userId: req.user._id }).sort({ createdAt: -1 }).select('tranId amountMinor currency status paidAt createdAt planId').lean(), ManualPayment.find({ userId: req.user._id }).sort({ createdAt: -1 }).select('transactionId amountMinor expectedMinor currency status submittedAt adminNote planId').lean()]);
  res.json({ ssl, manual });
});
exports.myBugs = asyncHandler(async (req, res) => res.json({ bugs: await BugReport.find({ userId: req.user._id }).sort({ createdAt: -1 }).select('reportId title status createdAt replies').lean() }));
