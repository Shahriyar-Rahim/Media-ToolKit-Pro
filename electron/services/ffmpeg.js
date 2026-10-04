const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const unpack = (p) => p && p.replace('app.asar', 'app.asar.unpacked');
const FFMPEG = unpack(require('ffmpeg-static'));
const FFPROBE = unpack(require('ffprobe-static').path);

function probe(file) {
  return new Promise((resolve) => {
    execFile(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 30000 }, (err, out) => {
        if (err) return resolve({ duration: null, hasVideo: null, hasAudio: null });
        try {
          const j = JSON.parse(out);
          resolve({
            duration: j.format && j.format.duration ? parseFloat(j.format.duration) : null,
            hasVideo: j.streams.some((s) => s.codec_type === 'video'),
            hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
          });
        } catch { resolve({ duration: null, hasVideo: null, hasAudio: null }); }
      });
  });
}

let hwCache = null;
// Per-OS hardware H.264 encoders. Each is only used if a real 1-frame test encode succeeds on THIS machine.
const HW_CANDIDATES = { win32: ['h264_nvenc', 'h264_amf', 'h264_qsv'], darwin: ['h264_videotoolbox'] };
const hwEncoderArgs = (name, qp = 23) => ({
  h264_nvenc: ['-c:v', 'h264_nvenc', '-rc', 'constqp', '-qp', String(qp)],
  h264_amf: ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', String(qp), '-qp_p', String(qp), '-qp_b', String(qp)],
  h264_qsv: ['-c:v', 'h264_qsv', '-global_quality', String(qp)],
  h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-q:v', String(Math.max(1, Math.min(100, 100 - qp * 2)))],
}[name]);
// Real capability test: attempt a 1-frame VAAPI encode. Never assume support.
async function detectHardware() {
  if (hwCache) return hwCache;
  const result = { vaapi: false, device: null, hwEncoder: null, encoders: [], reason: null };
  const enc = await new Promise((r) => execFile(FFMPEG, ['-hide_banner', '-encoders'], (e, o) => r(e ? '' : o)));
  result.encoders = ['h264_vaapi', 'hevc_vaapi', 'libx265', 'libx264', 'h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_videotoolbox'].filter((n) => enc.includes(n));
  if (process.platform !== 'linux') {
    for (const name of HW_CANDIDATES[process.platform] || []) {
      if (!result.encoders.includes(name) && !enc.includes(name)) continue;
      const ok = await new Promise((r) => execFile(FFMPEG, ['-hide_banner', '-f', 'lavfi', '-i', 'testsrc=size=256x256:rate=1', '-frames:v', '1', '-pix_fmt', 'yuv420p', '-c:v', name, '-f', 'null', '-'], { timeout: 15000 }, (e) => r(!e)));
      if (ok) { result.hwEncoder = name; return (hwCache = result); }
    }
    result.reason = 'No supported hardware encoder works on this computer; using CPU.'; return (hwCache = result);
  }
  const device = ['/dev/dri/renderD128', '/dev/dri/renderD129'].find((d) => fs.existsSync(d));
  if (!device || !result.encoders.includes('h264_vaapi')) {
    result.reason = !device ? 'No /dev/dri render device found.' : 'FFmpeg build lacks h264_vaapi.';
    return (hwCache = result);
  }
  const ok = await new Promise((r) => execFile(FFMPEG, ['-hide_banner', '-vaapi_device', device, '-f', 'lavfi', '-i',
    'testsrc=size=256x256:rate=1', '-frames:v', '1', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-'],
    { timeout: 15000 }, (e) => r(!e)));
  result.vaapi = ok; result.device = ok ? device : null;
  if (!ok) result.reason = 'VAAPI device present but test encode failed; using CPU.';
  return (hwCache = result);
}

// Runs ffmpeg with real progress from -progress pipe:1. Percent only when duration is known.
function run(args, { duration, ctl, onProgress }) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args]);
    ctl.kill = () => p.kill('SIGKILL');
    const t0 = Date.now(); let stderr = '', buf = '';
    p.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    p.stdout.on('data', (d) => {
      buf += d; const lines = buf.split('\n'); buf = lines.pop();
      const kv = Object.fromEntries(lines.filter((l) => l.includes('=')).map((l) => l.trim().split('=')));
      if (kv.out_time_us || kv.out_time_ms) {
        const sec = parseInt(kv.out_time_us || kv.out_time_ms, 10) / 1e6;
        const percent = duration ? Math.min(99, (sec / duration) * 100) : null;
        const elapsed = (Date.now() - t0) / 1000;
        const eta = percent && percent > 2 ? (elapsed * (100 - percent)) / percent : null;
        onProgress({ percent, elapsedSec: elapsed, etaSec: eta, speed: kv.speed || null, outputBytes: parseInt(kv.total_size, 10) || null });
      }
    });
    p.on('error', (e) => reject(new Error(`Could not start FFmpeg: ${e.message}`)));
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(ctl.cancelled ? 'Cancelled' : `FFmpeg failed (code ${code}): ${stderr.split('\n').slice(-4).join(' ').trim()}`)));
  });
}

function videoArgs(input, output, o, hw) {
  const rot = { 90: 'transpose=1', 180: 'hflip,vflip', 270: 'transpose=2' }[o.rotate];
  if (o.mode === 'remux') return ['-i', input, '-c', 'copy', '-movflags', '+faststart', output];
  if (o.mode === 'max') { // CPU HEVC
    const vf = rot ? ['-vf', rot] : [];
    return ['-i', input, ...vf, '-c:v', 'libx265', '-crf', String(o.crf ?? 23), '-preset', o.preset || 'medium',
      '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output];
  }
  if (o.mode === 'hardware' && hw.vaapi) { // AMD/VAAPI: explicit nv12, rotation before upload
    const chain = [rot, 'format=nv12', 'hwupload'].filter(Boolean).join(',');
    return ['-vaapi_device', hw.device, '-i', input, '-vf', chain, '-c:v', 'h264_vaapi', '-qp', String(o.qp ?? 23),
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output];
  }
  if (o.mode === 'hardware' && hw.hwEncoder) { // Windows/macOS: software filters (rotation) then the GPU encoder
    return ['-i', input, ...(rot ? ['-vf', rot] : []), '-pix_fmt', 'yuv420p', ...hwEncoderArgs(hw.hwEncoder, o.qp ?? 23), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output];
  }
  const vf = rot ? ['-vf', rot] : [];
  return ['-i', input, ...vf, '-c:v', 'libx264', '-crf', String(o.crf ?? 24), '-preset', 'medium',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output];
}

const AUDIO = {
  mp3: { ext: '.mp3', codec: ['-c:a', 'libmp3lame'], lossy: true },
  aac: { ext: '.m4a', codec: ['-c:a', 'aac'], lossy: true },
  wav: { ext: '.wav', codec: ['-c:a', 'pcm_s16le'], lossy: false },
  flac: { ext: '.flac', codec: ['-c:a', 'flac'], lossy: false },
};
function audioArgs(input, output, o) {
  const f = AUDIO[o.format];
  // bitrate 0 = best-quality VBR (same as the original script's extract mode: libmp3lame -q:a 2)
  const q = f.lossy && o.format === 'mp3' && o.bitrate === 0 ? ['-q:a', '2'] : f.lossy ? ['-b:a', `${o.bitrate || 192}k`] : [];
  return ['-i', input, '-vn', ...f.codec, ...q, output];
}
module.exports = { ffmpegPath: FFMPEG, hwEncoderArgs, probe, detectHardware, run, videoArgs, audioArgs, AUDIO };
