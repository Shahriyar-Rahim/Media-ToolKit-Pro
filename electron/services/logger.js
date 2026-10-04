const fs = require('fs');
const path = require('path');

// Separate persisted logs: app (developer), ffmpeg, security. Users never see these or raw stack traces;
// they only see the short messages the services throw. Logs are size-rotated and scrubbed of the home directory.
function createLogger({ dir, home = require('os').homedir(), maxBytes = 1024 * 1024, now = () => new Date() }) {
  fs.mkdirSync(dir, { recursive: true });
  const scrub = (s) => String(s).split(home).join('~').replace(/(password|token|secret|key)=\S+/gi, '$1=[redacted]');
  function write(channel, level, message, meta) {
    const file = path.join(dir, `${channel}.log`);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`); // keep one previous generation
      const extra = meta ? ` ${scrub(JSON.stringify(meta, (_k, v) => (v instanceof Error ? v.message : v)))}` : '';
      fs.appendFileSync(file, `${now().toISOString()} ${level.toUpperCase()} ${scrub(message)}${extra}\n`);
    } catch { /* logging must never break the app */ }
  }
  const api = { dir };
  for (const channel of ['app', 'ffmpeg', 'security']) api[channel] = (level, message, meta) => write(channel, level, message, meta);
  // Last N lines of the app and ffmpeg logs, for an optional bug-report attachment (user must opt in).
  api.recent = (lines = 150) => ['app', 'ffmpeg'].map((c) => { try { return `# ${c}.log\n${fs.readFileSync(path.join(dir, `${c}.log`), 'utf8').split('\n').slice(-lines).join('\n')}`; } catch { return `# ${c}.log\n(empty)`; } }).join('\n\n').slice(-18000);
  return api;
}
module.exports = { createLogger };
