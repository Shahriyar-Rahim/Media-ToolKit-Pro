const fs = require('fs');
const path = require('path');

const sanitize = (n) => n.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'output';

// Never overwrite: name.ext -> name (1).ext
function uniquePath(dir, base, ext) {
  base = sanitize(base);
  let p = path.join(dir, base + ext), i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

async function resolveOutputDir(settings, sourcePath) {
  const dir = settings.outputMode === 'custom' && settings.outputDir ? settings.outputDir : path.dirname(sourcePath);
  try { await fs.promises.mkdir(dir, { recursive: true }); await fs.promises.access(dir, fs.constants.W_OK); }
  catch (e) { throw new Error(`Output folder is not accessible: ${dir} (${e.code || e.message})`); }
  return dir;
}

async function assertDiskSpace(dir, neededBytes) {
  if (!fs.promises.statfs) return;
  const s = await fs.promises.statfs(dir);
  if (s.bavail * s.bsize < neededBytes) throw new Error('Not enough free disk space in the output folder.');
}

async function assertReadable(p) {
  try { await fs.promises.access(p, fs.constants.R_OK); }
  catch { throw new Error(`Source file is missing or unreadable: ${p}`); }
}
module.exports = { uniquePath, resolveOutputDir, assertDiskSpace, assertReadable, sanitize };
