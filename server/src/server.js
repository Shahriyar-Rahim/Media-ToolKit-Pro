const mongoose = require('mongoose');
const env = require('./config/env');
const { createApp } = require('./app');

(async () => {
  await mongoose.connect(env.mongoUri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes())); // unique indexes are security controls; make sure they exist
  const server = createApp().listen(env.port, () => console.log(`API listening on :${env.port} (${env.prod ? 'production' : 'development'})`));
  require('./jobs').start();
  const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
