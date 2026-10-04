import React, { useCallback, useEffect, useState } from 'react';
import { call } from '../lib/api.js';

export const Card = ({ title, children, className = '' }) => <section className={`panel p-4 ${className}`}>{title && <h2 className="font-semibold mb-3">{title}</h2>}{children}</section>;
export const Field = ({ label, hint, children }) => <label className="flex flex-col gap-1 text-sm"><span style={{ color: 'var(--mute)' }}>{label}</span>{children}{hint && <span className="text-xs" style={{ color: 'var(--mute)' }}>{hint}</span>}</label>;
export const Msg = ({ kind = 'error', children }) => children ? <p role={kind === 'error' ? 'alert' : 'status'} className="text-sm my-2" style={{ color: kind === 'error' ? 'var(--danger)' : 'var(--ok)' }}>{children}</p> : null;
export const Btn = ({ primary, className = '', ...p }) => <button className={`btn ${primary ? 'btn-primary' : ''} ${className}`} {...p} />;
export const Chip = ({ children, tone }) => <span className="text-xs px-2 py-0.5 rounded" style={{ border: '1px solid var(--line)', color: tone === 'ok' ? 'var(--ok)' : tone === 'bad' ? 'var(--danger)' : 'var(--mute)' }}>{children}</span>;

// Run an async action with busy + error state (used by every form).
export function useAction() {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const run = useCallback(async (fn, success) => { setBusy(true); setErr(''); setOk(''); try { const r = await fn(); if (success) setOk(success); return r; } catch (e) { setErr(e.message); return undefined; } finally { setBusy(false); } }, []);
  return { busy, err, ok, run, setErr, setOk };
}
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  const reload = useCallback(() => fn().then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message)), deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return { data, err, reload };
}

// Server-side paginated table: never loads more than one page.
export function DataTable({ path, columns, filters = [], extra = '', refreshKey }) {
  const [page, setPage] = useState(1); const [q, setQ] = useState(''); const [status, setStatus] = useState('');
  const { data, err, reload } = useLoad(() => call('GET', `${path}?page=${page}&limit=15${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}${extra}`), [path, page, q, status, extra, refreshKey]);
  return (
    <div>
      <div className="flex gap-3 mb-3"><input aria-label="Search" placeholder="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        {filters.length > 0 && <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option>{filters.map((f) => <option key={f}>{f}</option>)}</select>}</div>
      <Msg>{err}</Msg>
      <div className="panel overflow-x-auto"><table className="w-full text-left text-sm"><thead style={{ color: 'var(--mute)' }}><tr>{columns.map((c) => <th key={c.h} className="p-2">{c.h}</th>)}</tr></thead>
        <tbody>{data && data.items.length === 0 && <tr><td className="p-4" colSpan={columns.length} style={{ color: 'var(--mute)' }}>Nothing found.</td></tr>}
          {data && data.items.map((row) => <tr key={row._id} style={{ borderTop: '1px solid var(--line)' }}>{columns.map((c) => <td key={c.h} className="p-2 align-top">{c.render(row, reload)}</td>)}</tr>)}</tbody></table></div>
      {data && <div className="flex gap-3 items-center mt-3 text-sm"><Btn disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn><span>Page {data.page} of {Math.max(1, data.pages)} · {data.total} total</span><Btn disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Btn></div>}
    </div>
  );
}
export const Tabs = ({ tabs, value, onChange }) => <div role="tablist" className="flex flex-wrap gap-1 mb-4" style={{ borderBottom: '1px solid var(--line)' }}>{tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={value === id} className="nav" style={{ width: 'auto', borderRadius: '6px 6px 0 0', color: value === id ? 'var(--ink)' : undefined, borderBottom: value === id ? '2px solid var(--accent)' : '2px solid transparent' }} onClick={() => onChange(id)}>{label}</button>)}</div>;
