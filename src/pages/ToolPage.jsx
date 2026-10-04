import React, { useEffect, useState } from 'react';
import { FolderOpen, Play } from 'lucide-react';
import JobList from './JobList.jsx';
import { fmtBytes } from '../lib/useJobs.js';

// One data-driven page for every offline tool; each config maps to a validated job type.
const TOOLS = {
  video: { title: 'Video', kind: 'video', type: 'video', batch: true,
    fields: [
      { key: 'mode', label: 'Method', options: [['cpu', 'Re-encode · H.264 (CPU)'], ['hardware', 'Re-encode · H.264 (GPU/VAAPI, falls back to CPU)'], ['max', 'Re-encode · Maximum compression (H.265, slow)'], ['remux', 'Remux only · no re-encode, instant, no quality change']], def: 'cpu' },
      { key: 'rotate', label: 'Rotate', options: [[0, 'None'], [90, '90°'], [180, '180°'], [270, '270°']], def: 0, num: true, hideFor: ['remux'] } ],
    hint: (o) => o.mode === 'remux' ? 'Remux copies streams into a new .mp4. Fast and lossless, but the file size barely changes.' : 'Re-encode rewrites the video. Slower, smaller files, small quality trade-off.' },
  audio: { title: 'Audio', kind: 'audio', type: 'audio', batch: true,
    fields: [ { key: 'format', label: 'Format', options: [['mp3', 'MP3'], ['aac', 'AAC (.m4a)'], ['wav', 'WAV'], ['flac', 'FLAC']], def: 'mp3' },
      { key: 'bitrate', label: 'Bitrate (MP3/AAC)', options: [[0, 'Best quality (VBR)'], [96, '96 kbps'], [128, '128 kbps'], [192, '192 kbps'], [320, '320 kbps']], def: 96, num: true } ],
    hint: () => 'Works on audio files, and extracts audio from video files.' },
  images: { title: 'Images', kind: 'images', type: 'heic', batch: true,
    fields: [ { key: 'quality', label: 'JPG quality', options: [[80, '80'], [92, '92'], [100, '100']], def: 92, num: true } ],
    hint: () => 'Converts HEIC, PNG, WebP and other images to JPG. A failed file never stops the rest of the batch.' },
  pdf: { title: 'PDF', kind: 'images', type: 'imagesToPdf', batch: false, combine: true,
    fields: [], hint: () => 'Choose images in the order you want them, then create one PDF. Use "Merge PDFs" below to join existing PDFs.', mergeToo: true },
};

export default function ToolPage({ id }) {
  const t = TOOLS[id];
  const [files, setFiles] = useState([]); const [opts, setOpts] = useState({}); const [name, setName] = useState('');
  const [hw, setHw] = useState(null); const [msg, setMsg] = useState('');
  useEffect(() => { setFiles([]); setMsg(''); setOpts(Object.fromEntries(t.fields.map((f) => [f.key, f.def]))); }, [id]);
  useEffect(() => { if (id === 'video') window.mediaAPI.detectHardware().then(setHw); }, [id]);

  const pick = async (kind) => {
    const picked = await window.mediaAPI.selectFiles({ kind });
    setFiles((cur) => { const seen = new Set(cur.map((f) => f.path)); return [...cur, ...picked.filter((f) => !seen.has(f.path))]; });
  };
  const move = (i, d) => setFiles((f) => { const n = [...f]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const start = async (type, combine) => {
    if (!files.length) { setMsg('Choose at least one file first.'); return; }
    setMsg('');
    try {
      const options = { ...opts, ...(name ? { filename: name } : {}) };
      if (combine) await window.mediaAPI.enqueue({ type, input: files.map((f) => f.path), options });
      else for (const f of files) await window.mediaAPI.enqueue({ type, input: f.path, options, batchSize: files.length });
      setFiles([]);
    } catch (e) { setMsg(e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  };
  const shown = t.fields.filter((f) => !(f.hideFor || []).includes(opts.mode));

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">{t.title}</h1>
      <p style={{ color: 'var(--mute)' }}>{t.hint(opts)}</p>
      {id === 'video' && hw && <p className="mt-2 text-sm" style={{ color: hw.vaapi ? 'var(--ok)' : 'var(--mute)' }}>{hw.vaapi ? 'Hardware acceleration available (VAAPI)' : `CPU fallback · ${hw.reason || ''}`}</p>}
      <div className="panel p-4 mt-4">
        <div className="flex flex-wrap gap-3 items-end">
          <button className="btn" onClick={() => pick(t.kind)}><FolderOpen size={14} className="inline mr-2" />Choose files</button>
          {shown.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-xs" style={{ color: 'var(--mute)' }}>{f.label}
              <select value={opts[f.key]} onChange={(e) => setOpts({ ...opts, [f.key]: f.num ? Number(e.target.value) : e.target.value })}>
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>))}
          {t.combine && <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--mute)' }}>Output filename<input value={name} onChange={(e) => setName(e.target.value)} placeholder="combined_photos" /></label>}
        </div>
        {files.length > 0 && <ul className="mt-3">{files.map((f, i) => (
          <li key={f.path} className="flex justify-between py-1" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="truncate">{f.name} <span style={{ color: 'var(--mute)' }}>{fmtBytes(f.size)}</span></span>
            <span className="flex gap-1">
              {t.combine && <><button className="btn" aria-label="Move up" onClick={() => move(i, -1)}>↑</button><button className="btn" aria-label="Move down" onClick={() => move(i, 1)}>↓</button></>}
              <button className="btn" aria-label="Remove file" onClick={() => setFiles(files.filter((x) => x.path !== f.path))}>×</button></span></li>))}</ul>}
        <div className="mt-4 flex gap-3 items-center">
          <button className="btn btn-primary" disabled={!files.length} onClick={() => start(t.type, t.combine)}><Play size={14} className="inline mr-2" />{t.combine ? 'Create PDF' : `Start ${files.length || ''}`}</button>
          {t.mergeToo && <button className="btn" onClick={() => pick('pdf')}>Choose PDFs to merge</button>}
          {t.mergeToo && <button className="btn" disabled={files.length < 2 || !files.every((f) => /\.pdf$/i.test(f.name))} onClick={() => start('mergePdf', true)}>Merge PDFs</button>}
          {msg && <span role="alert" style={{ color: 'var(--danger)' }}>{msg}</span>}
        </div>
      </div>
      <JobList types={t.mergeToo ? ['imagesToPdf', 'mergePdf'] : [t.type]} />
    </div>
  );
}
