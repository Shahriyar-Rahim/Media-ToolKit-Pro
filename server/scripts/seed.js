// Creates the first admin (from env, never hard-coded) and starter data. Safe to re-run.
const mongoose = require('mongoose');
const env = require('../src/config/env');
const { User, SubscriptionPlan, PaymentGatewayConfig, FAQ } = require('../src/models');
const auth = require('../src/services/auth');

(async () => {
  await mongoose.connect(env.mongoUri);
  const { SEED_ADMIN_EMAIL: e, SEED_ADMIN_PASSWORD: p } = process.env;
  if (e && p) {
    if (p.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
    await User.updateOne({ email: e.toLowerCase() }, { $setOnInsert: { email: e.toLowerCase(), passwordHash: await auth.hashPassword(p), role: 'SUPER_ADMIN', emailVerifiedAt: new Date(), name: 'Admin' } }, { upsert: true });
    console.log('Admin ready:', e);
  } else console.log('No SEED_ADMIN_* set; skipping admin creation.');
  const starter = [
    { name: 'Basic', slug: 'basic', priceMinor: 19900, billingPeriodDays: 30, rank: 1, sortOrder: 1, entitlements: { features: { videoCompression: true, audioConversion: true, heicConversion: true, pdfCreate: true, pdfMerge: true, mediaVault: true }, limits: { dailyJobs: 20, maxFileSizeMB: 1024 } } },
    { name: 'Pro', slug: 'pro', priceMinor: 49900, billingPeriodDays: 30, rank: 2, sortOrder: 2, entitlements: { features: { videoCompression: true, hardwareAcceleration: true, maximumCompression: true, audioConversion: true, heicConversion: true, pdfCreate: true, pdfMerge: true, batchProcessing: true, mediaVault: true, advancedSettings: true }, limits: {} } },
    { name: 'Lifetime', slug: 'lifetime', priceMinor: 999900, isLifetime: true, rank: 3, sortOrder: 3, entitlements: { features: { videoCompression: true, hardwareAcceleration: true, maximumCompression: true, audioConversion: true, heicConversion: true, pdfCreate: true, pdfMerge: true, batchProcessing: true, mediaVault: true, priorityProcessing: true, advancedSettings: true }, limits: {} } },
  ];
  for (const s of starter) await SubscriptionPlan.updateOne({ slug: s.slug }, { $setOnInsert: s }, { upsert: true });
  for (const k of ['SSLCOMMERZ', 'MFS']) await PaymentGatewayConfig.updateOne({ key: k }, { $setOnInsert: { key: k, enabled: false } }, { upsert: true }); // payments start OFF until an admin enables them
  if (!(await FAQ.countDocuments())) await FAQ.create([{ category: 'getting-started', question: 'Does processing need internet?', answer: 'No. Video, audio, image and PDF tools run locally on your computer. Internet is only used for sign-in, plans and payments.' }, { category: 'video', question: 'What is the difference between remux and re-encode?', answer: 'Remux copies the video into a new container without changing quality and is very fast. Re-encode rewrites the video to make it smaller and is slower.' }]);
  console.log('Seed complete.'); await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
