import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, FolderOpen, ExternalLink, Video, Music, Image as ImageIcon, FileText, LayoutGrid, List } from 'lucide-react';
import { fmtBytes } from '../lib/useJobs.js';
import { Card, Btn } from '../components/ui.jsx';

const ICON = { video: Video, audio: Music, image: ImageIcon, pdf: FileText };

function Thumb({ row }) {
  const [src, setSrc] = useState(null); const Icon = ICON[row.media_type] || FileText;
  useEffect(() => { let live = true; if (row.success && ['image', 'video'].includes(row.media_type)) window.mediaAPI.thumbnail(row.id).then((u) => live && setSrc(u)).catch(() => {}); return () => { live = false; }; }, [row.id]); // eslint-disable-line
  return src ? <img src={src} alt={`Preview of ${row.output_name || row.original_name}`} className="w-full h-28 object-cover rounded" /> : <div className="w-full h-28 flex items-center justify-center rounded" style={{ background: 'var(--bg)' }} aria-hidden="true"><Icon size={28} style={{ color: 'var(--mute)' }} /></div>;
}

export default function Vault({ allowed = true, goto }) {
  const [rows, setRows] = useState([]); const [q, setQ] = useState(''); const [mt, setMt] = useState(''); const [sort, setSort] = useState('new'); const [confirm, setConfirm] = useState(false); const [view, setView] = useState('list');
  const load = useCallback(() => window.mediaAPI.getHistory({ search: q, mediaType: mt, sort }).then(setRows), [q, mt, sort]);
  useEffect(() => { if (!allowed) return undefined; load(); const off = window.mediaAPI.onJobUpdate((j) => { if (['COMPLETED', 'FAILED'].includes(j.status)) setTimeout(load, 300); }); return off; }, [load, allowed]);
  if (!allowed) return <div><h1 className="text-xl font-semibold mb-3">Media Vault</h1><Card><p>Media Vault is not included in your current plan. Your history is still being saved on this computer and will appear when you have a plan that includes it.</p><Btn primary className="mt-3" onClick={() => goto && goto('pricing')}>See plans</Btn></Card></div>;
  const remove = async (id) => { await window.mediaAPI.deleteHistory(id); load(); };
  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">Media Vault</h1>
      <div className="flex flex-wrap gap-3 mb-3">
        <input aria-label="Search" placeholder="Search filename" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Type" value={mt} onChange={(e) => setMt(e.target.value)}><option value="">All types</option><option value="video">Video</option><option value="audio">Audio</option><option value="image">Images</option><option value="pdf">PDF</option></select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}><option value="new">Newest</option><option value="old">Oldest</option><option value="size">Largest output</option></select>
        <div role="group" aria-label="View" className="flex gap-1"><button className="btn" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} className="inline mr-1" />List</button><button className="btn" aria-pressed={view === 'gallery'} onClick={() => setView('gallery')}><LayoutGrid size={14} className="inline mr-1" />Gallery</button></div>
        <button className="btn" onClick={() => setConfirm(true)}>Clear history</button>
      </div>
      {confirm && <div role="alertdialog" className="panel p-3 mb-3">This removes history records only. Your files are not deleted.
        <button className="btn ml-3" onClick={async () => { await window.mediaAPI.clearHistory(); setConfirm(false); load(); }}>Clear records</button>
        <button className="btn ml-2" onClick={() => setConfirm(false)}>Cancel</button></div>}
      {rows.length === 0 ? <p className="panel p-6" style={{ color: 'var(--mute)' }}>Nothing here yet. Finished jobs show up in the vault automatically.</p>
        : view === 'gallery' ? <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>{rows.map((r) => (
          <div key={r.id} className="panel p-2"><Thumb row={r} /><div className="mt-2 text-sm truncate" title={r.output_name || r.original_name}>{r.output_name || r.original_name}</div>
            <div className="text-xs" style={{ color: r.success ? 'var(--mute)' : 'var(--danger)' }}>{r.success ? `${r.operation} · ${fmtBytes(r.output_size)}` : 'Failed'}</div>
            <div className="flex gap-1 mt-2">{r.output_path && <><button className="btn" aria-label="Open file" onClick={() => window.mediaAPI.openPath(r.output_path)}><ExternalLink size={14} /></button><button className="btn" aria-label="Show in folder" onClick={() => window.mediaAPI.showInFolder(r.output_path)}><FolderOpen size={14} /></button></>}<button className="btn" aria-label="Remove record" onClick={() => remove(r.id)}><Trash2 size={14} /></button></div></div>))}</div>
        : <div className="panel overflow-x-auto"><table className="w-full text-left"><thead style={{ color: 'var(--mute)' }}><tr><th className="p-2">File</th><th>Operation</th><th>Input</th><th>Output</th><th>Ratio</th><th>Time</th><th>Result</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
              <td className="p-2 max-w-xs truncate" title={r.source_path}>{r.original_name}</td><td>{r.operation}</td><td>{fmtBytes(r.input_size)}</td><td>{fmtBytes(r.output_size)}</td>
              <td>{r.ratio ? `${(r.ratio * 100).toFixed(0)}%` : '—'}</td><td>{r.processing_ms ? `${(r.processing_ms / 1000).toFixed(1)}s` : '—'}</td>
              <td style={{ color: r.success ? 'var(--ok)' : 'var(--danger)' }}>{r.success ? 'Done' : 'Failed'}</td>
              <td className="flex gap-1 p-1">{r.output_path && <><button className="btn" aria-label="Open file" onClick={() => window.mediaAPI.openPath(r.output_path)}><ExternalLink size={14} /></button>
                <button className="btn" aria-label="Show in folder" onClick={() => window.mediaAPI.showInFolder(r.output_path)}><FolderOpen size={14} /></button></>}
                <button className="btn" aria-label="Remove record" onClick={() => remove(r.id)}><Trash2 size={14} /></button></td></tr>))}</tbody></table></div>}
    </div>
  );
}
