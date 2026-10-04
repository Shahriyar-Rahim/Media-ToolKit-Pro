const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const ff = require('./ffmpeg');
const docs = require('./docs');
const { uniquePath, resolveOutputDir, assertDiskSpace, assertReadable } = require('./fsSafe');

const MEDIA = { video: 'video', audio: 'audio', heic: 'image', imagesToPdf: 'pdf', mergePdf: 'pdf' };

function makeRunners({ db, getSettings }) {
  const record = (job, out, ok, started, extra = {}) => {
    const src = Array.isArray(job.input) ? job.input[0] : job.input;
    let outSize = null, inSize = null;
    try { outSize = ok ? fs.statSync(out).size : null; } catch {}
    try { inSize = (Array.isArray(job.input) ? job.input : [job.input]).reduce((a, f) => a + fs.statSync(f).size, 0); } catch {}
    db.addHistory({
      id: randomUUID(), original_name: path.basename(src), output_name: out ? path.basename(out) : null,
      source_path: src, output_path: ok ? out : null, operation: job.type, media_type: MEDIA[job.type],
      created_at: Date.now(), duration_sec: extra.duration ?? null, input_size: inSize, output_size: outSize,
      ratio: inSize && outSize ? +(outSize / inSize).toFixed(3) : null, success: ok ? 1 : 0,
      processing_ms: Date.now() - started, settings: JSON.stringify(job.options),
    });
  };

  // Shared wrapper: validate, pick safe output path, run, always record history, clean partial output.
  const single = (ext, work) => async (job, { ctl, progress }) => {
    const started = Date.now(), settings = getSettings(); let out = null, meta = {};
    try {
      await assertReadable(job.input);
      const dir = await resolveOutputDir(settings, job.input);
      const stat = fs.statSync(job.input);
      await assertDiskSpace(dir, stat.size * 1.2);
      out = uniquePath(dir, path.parse(job.input).name + (job.options.suffix || ''), ext(job.options));
      meta = (await work(job, out, { ctl, progress })) || {};
      record(job, out, true, started, meta); return out;
    } catch (e) {
      if (out) fs.promises.unlink(out).catch(() => {});
      record(job, null, false, started, meta); throw e;
    }
  };

  return {
    video: single(() => '.mp4', async (job, out, { ctl, progress }) => {
      const hw = await ff.detectHardware(); const info = await ff.probe(job.input);
      const o = { ...job.options };
      if (o.mode === 'hardware' && !hw.vaapi && !hw.hwEncoder) { o.mode = 'cpu'; progress({ percent: null, note: 'Hardware unavailable, using CPU' }); }
      if (info.hasVideo === false) throw new Error('This file has no video stream.');
      await ff.run(ff.videoArgs(job.input, out, o, hw), { duration: info.duration, ctl, onProgress: progress });
      return { duration: info.duration };
    }),
    audio: single((o) => ff.AUDIO[o.format].ext, async (job, out, { ctl, progress }) => {
      const info = await ff.probe(job.input);
      if (info.hasAudio === false) throw new Error('This file has no audio stream.');
      await ff.run(ff.audioArgs(job.input, out, job.options), { duration: info.duration, ctl, onProgress: progress });
      return { duration: info.duration };
    }),
    heic: single(() => '.jpg', async (job, out) => { await docs.heicToJpg(job.input, out, job.options.quality); }),
    imagesToPdf: async (job) => {
      const started = Date.now(), settings = getSettings(); let out = null;
      try {
        await Promise.all(job.input.map(assertReadable));
        const dir = await resolveOutputDir(settings, job.input[0]);
        out = uniquePath(dir, job.options.filename || 'combined_photos', '.pdf');
        await docs.imagesToPdf(job.input, out); record(job, out, true, started); return out;
      } catch (e) { record(job, null, false, started); throw e; }
    },
    mergePdf: async (job) => {
      const started = Date.now(), settings = getSettings(); let out = null;
      try {
        await Promise.all(job.input.map(assertReadable));
        const dir = await resolveOutputDir(settings, job.input[0]);
        out = uniquePath(dir, job.options.filename || 'merged_document', '.pdf');
        await docs.mergePdfs(job.input, out); record(job, out, true, started); return out;
      } catch (e) { record(job, null, false, started); throw e; }
    },
  };
}
module.exports = { makeRunners };
