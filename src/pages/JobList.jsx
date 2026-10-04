import React from 'react';
import { X, RotateCcw } from 'lucide-react';
import { useJobs, fmtBytes, fmtTime } from '../lib/useJobs.js';

export default function JobList({ types }) {
  const { list, counts } = useJobs();
  const rows = types ? list.filter((j) => types.includes(j.type)) : list;
  return (
    <section aria-label="Jobs" className="panel p-4 mt-4">
      <div className="flex gap-6 mb-3" style={{ color: 'var(--mute)' }}>
        <span>Completed: {counts.done}/{counts.total}</span><span>Failed: {counts.failed}/{counts.total}</span><span>Remaining: {counts.remaining}/{counts.total}</span>
      </div>
      {rows.length === 0 && <p style={{ color: 'var(--mute)' }}>No jobs yet. Choose files and press Start.</p>}
      {rows.map((j) => {
        const p = j.progress || {}; const name = (Array.isArray(j.input) ? `${j.input.length} files` : j.input.split(/[\\/]/).pop());
        return (
          <div key={j.id} className="py-2" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="truncate"><strong>{name}</strong> <span style={{ color: 'var(--mute)' }}>{j.type} · {j.status.toLowerCase()}</span></div>
              <div className="flex gap-2">
                {['QUEUED', 'PROCESSING'].includes(j.status) && <button className="btn" aria-label="Cancel job" onClick={() => window.mediaAPI.cancelJob(j.id)}><X size={14} /></button>}
                {['FAILED', 'CANCELLED'].includes(j.status) && <button className="btn" aria-label="Retry job" onClick={() => window.mediaAPI.retryJob(j.id)}><RotateCcw size={14} /></button>}
              </div>
            </div>
            {j.status === 'PROCESSING' && (
              <div className="mt-2">
                <progress className="w-full" value={p.percent ?? undefined} max="100" />
                <div className="text-xs" style={{ color: 'var(--mute)' }}>
                  {p.percent != null ? `${p.percent.toFixed(0)}%` : 'Working (progress unavailable)'} · elapsed {fmtTime(p.elapsedSec)} · ETA {fmtTime(p.etaSec)} · speed {p.speed || '—'} · output {fmtBytes(p.outputBytes)} {p.note ? `· ${p.note}` : ''}
                </div>
              </div>)}
            {j.status === 'FAILED' && <div role="alert" className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{j.error}</div>}
            {j.status === 'COMPLETED' && typeof j.output === 'string' && <div className="text-xs mt-1" style={{ color: 'var(--ok)' }}>Saved to {j.output}</div>}
          </div>);
      })}
    </section>
  );
}
