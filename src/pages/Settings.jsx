import React, { useEffect, useState } from 'react';
import { Btn, Msg, Card, useAction } from '../components/ui.jsx';
export default function Settings({ onTheme }) {
  const [s, setS] = useState(null); const [info, setInfo] = useState(null); const [upd, setUpd] = useState(null); const a = useAction();
  useEffect(() => { window.mediaAPI.getSettings().then(setS); window.mediaAPI.appInfo().then(setInfo); }, []);
  if (!s) return null;
  const set = async (p) => { const n = await window.mediaAPI.setSettings(p); setS(n); if (p.theme) onTheme(p.theme); };
  return (
    <div className="max-w-xl"><h1 className="text-xl font-semibold mb-3">Settings</h1>
      <div className="panel p-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1">Save outputs to
          <select value={s.outputMode} onChange={(e) => e.target.value === 'custom' && !s.outputDir ? window.mediaAPI.chooseOutputDirectory().then(setS) : set({ outputMode: e.target.value })}>
            <option value="source">Same folder as the source file</option><option value="custom">A custom folder</option></select></label>
        {s.outputMode === 'custom' && <div><button className="btn" onClick={() => window.mediaAPI.chooseOutputDirectory().then(setS)}>Change folder</button> <span style={{ color: 'var(--mute)' }}>{s.outputDir}</span></div>}
        <label className="flex flex-col gap-1">Jobs at the same time
          <select value={s.concurrency} onChange={(e) => set({ concurrency: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
        <label className="flex flex-col gap-1">Theme
          <select value={s.theme} onChange={(e) => set({ theme: e.target.value })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <p className="text-xs" style={{ color: 'var(--mute)' }}>Media Toolkit Pro v{info ? info.version : ''} · Files are never overwritten; a numbered copy is created instead.</p>
      </div>
      <Card title="Updates" className="mt-4">
        <p className="text-sm mb-3" style={{ color: 'var(--mute)' }}>Updates are checked only when you ask, and installed only when you confirm.</p>
        <div className="flex flex-wrap gap-2 items-center">
          <Btn disabled={a.busy} onClick={() => a.run(async () => setUpd(await window.mediaAPI.updateCheck()))}>Check for updates</Btn>
          {upd && upd.available && !upd.downloaded && <Btn primary disabled={a.busy} onClick={() => a.run(async () => { const r = await window.mediaAPI.updateDownload(); setUpd(r.ok ? { ...upd, downloaded: true } : { error: r.error || 'Download failed.' }); })}>Download version {upd.version}</Btn>}
          {upd && upd.downloaded && <Btn primary onClick={() => window.mediaAPI.updateInstall()}>Restart and install</Btn>}
        </div>
        {upd && <p role="status" className="text-sm mt-2">{upd.error || upd.message || (upd.available ? `Version ${upd.version} is available.` : 'You are up to date.')}</p>}<Msg>{a.err}</Msg>
      </Card></div>);
}
