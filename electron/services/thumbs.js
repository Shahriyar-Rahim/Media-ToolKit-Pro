const fs = require('fs');
const { execFile } = require('child_process');
const { callWorker } = require("./imageHost");

// Vault gallery thumbnails: images via Sharp, videos via one FFmpeg frame. Anything else (audio, PDF) gets an icon in the UI.
function createThumbs({ ffmpegPath, limit = 300 }) {
  const cache = new Map();
  const remember = (k, v) => { cache.set(k, v); if (cache.size > limit) cache.delete(cache.keys().next().value); return v; };
  async function make(file, mediaType) {
    if (mediaType === "image") {
      const b64 = await callWorker("thumbnail", { input: file });
      return b64 ? Buffer.from(b64, "base64") : null;
    }
    if (mediaType === 'video') return new Promise((resolve, reject) => execFile(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=200:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { encoding: 'buffer', maxBuffer: 4 * 1048576, timeout: 20000 }, (e, out) => (e || !out.length ? reject(e || new Error('no frame')) : resolve(out))));
    return null;
  }
  return async (row) => { // row comes from our own history table, never from the renderer's raw path
    if (!row || !row.output_path || !row.success) return null;
    const key = `${row.id}`; if (cache.has(key)) return cache.get(key);
    try { await fs.promises.access(row.output_path); const buf = await make(row.output_path, row.media_type); return remember(key, buf ? `data:image/jpeg;base64,${buf.toString('base64')}` : null); }
    catch { return remember(key, null); } // missing file or unsupported frame: icon fallback
  };
}
module.exports = { createThumbs };
