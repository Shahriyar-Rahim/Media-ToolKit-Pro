import React, { useEffect, useState } from 'react';
import { call, FEATURE_LABELS } from '../../lib/api.js';
import { Card, Field, Btn, Msg, useAction, useLoad } from '../../components/ui.jsx';

// Settings that are lists of text lines (one per line in the form).
const LIST_KEYS = { blockedEmailDomains: ['Blocked email domains', 'One per line, e.g. mailinator.com. People using these cannot register.'], paymentNotifyEmails: ['Payment notification emails', 'One per line. These addresses are emailed about every new payment. Leave empty to notify all active admins.'] };
const NUMERIC_NULLABLE = { freeAccess: ['trialDays', 'operationCount', 'dailyLimit', 'monthlyLimit', 'maxFileSizeMB'] };
const TITLES = { app: 'Application', security: 'Security and OTP', freeAccess: 'Free access (trial)', subscription: 'Subscriptions' };
const HINTS = { minDesktopVersion: 'Older desktop apps see an "update required" notice and online features pause; local tools keep working.', adminReauthRequired: 'Sensitive admin actions (refunds, grants, settings...) ask for an emailed code first.', adminReauthMinutes: 'How long one confirmation stays valid.', trialDays: 'Days after email verification. Empty = no time limit.', operationCount: 'Total free operations. Empty = unlimited.', dailyLimit: 'Per day. Empty = unlimited.', monthlyLimit: 'Per month. Empty = unlimited.', maxFileSizeMB: 'Empty = no limit.', maintenanceMode: 'Online features show "Service temporarily unavailable". Offline tools keep working.', adminTwoFactorRequired: 'Admins must enter an email code at every login.' };

export function SettingsEditor() {
  const { data, err, reload } = useLoad(() => call('GET', '/api/admin/settings'));
  if (err) return <Msg>{err}</Msg>; if (!data) return <p>Loading…</p>;
  return <div className="grid gap-4 max-w-2xl"><VersionCard />{Object.keys(TITLES).map((g) => <Group key={g} name={g} initial={data[g]} onSaved={reload} />)}<p className="text-xs" style={{ color: 'var(--mute)' }}>SMTP and payment gateway credentials are set on the server (environment variables) and are never shown here.</p></div>;
}
function VersionCard() {
  const { data } = useLoad(() => call('GET', '/api/admin/version'));
  return <Card title="Versions">{data ? <p className="text-sm">Server <strong>v{data.server}</strong> · Minimum supported desktop app <strong>v{data.minDesktopVersion}</strong> <span style={{ color: 'var(--mute)' }}>(change it below under Application)</span></p> : <p className="text-sm">Loading…</p>}</Card>;
}
function Group({ name, initial, onSaved }) {
  const toForm = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, LIST_KEYS[k] && Array.isArray(v) ? v.join('\n') : v]));
  const [v, setV] = useState(toForm(initial)); const a = useAction(); useEffect(() => setV(toForm(initial)), [initial]); // eslint-disable-line
  const save = () => a.run(async () => {
    const body = {}; for (const [k, val] of Object.entries(v)) body[k] = LIST_KEYS[k] ? String(val).split(/[\s,]+/).filter(Boolean) : NUMERIC_NULLABLE[name] && NUMERIC_NULLABLE[name].includes(k) ? (val === '' || val == null ? null : Number(val)) : typeof initial[k] === 'number' ? Number(val) : val;
    await call('PUT', `/api/admin/settings/${name}`, body); onSaved();
  }, 'Saved. Changes apply within a few seconds.');
  return (<Card title={TITLES[name]}><div className="grid gap-3">{Object.entries(v).map(([k, val]) => {
    const set = (x) => setV({ ...v, [k]: x });
    if (LIST_KEYS[k]) return <Field key={k} label={LIST_KEYS[k][0]} hint={LIST_KEYS[k][1]}><textarea rows={4} value={val} onChange={(e) => set(e.target.value)} style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 6, padding: 8 }} /></Field>;
    if (Array.isArray(val)) return <fieldset key={k}><legend className="text-sm mb-1" style={{ color: 'var(--mute)' }}>Free tools</legend><div className="grid grid-cols-2 gap-1">{Object.keys(FEATURE_LABELS).map((f) => <label key={f} className="text-sm"><input type="checkbox" checked={val.includes(f)} onChange={(e) => set(e.target.checked ? [...val, f] : val.filter((x) => x !== f))} /> {FEATURE_LABELS[f]}</label>)}</div></fieldset>;
    if (typeof val === 'boolean') return <Field key={k} label={k} hint={HINTS[k]}><input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} style={{ width: 20, height: 20 }} /></Field>;
    const isNum = typeof val === 'number' || (NUMERIC_NULLABLE[name] || []).includes(k);
    return <Field key={k} label={k} hint={HINTS[k]}><input type={isNum ? 'number' : 'text'} value={val ?? ''} onChange={(e) => set(e.target.value)} /></Field>;
  })}</div><Msg>{a.err}</Msg><Msg kind="ok">{a.ok}</Msg><Btn primary className="mt-3" disabled={a.busy} onClick={save}>Save {TITLES[name]}</Btn></Card>);
}
export function GatewayToggles() {
  const { data, err, reload } = useLoad(() => call('GET', '/api/admin/gateways')); const a = useAction();
  if (!data) return <Msg>{err}</Msg>;
  const row = (key, label, note) => <label key={key} className="flex items-center gap-3 py-2"><input type="checkbox" style={{ width: 20, height: 20 }} checked={data[key]} disabled={a.busy} onChange={(e) => a.run(async () => { await call('PUT', `/api/admin/gateways/${key}`, { enabled: e.target.checked }); reload(); })} /><span><strong>{label}</strong><br /><span className="text-xs" style={{ color: 'var(--mute)' }}>{note}</span></span></label>;
  return <Card title="Payment methods">{row('SSLCOMMERZ', 'SSLCommerz (online)', 'Needs server credentials. If credentials are missing it stays hidden from users even when on.')}{row('MFS', 'Manual mobile financial service', 'Needs at least one enabled MFS account. Payments are activated only after you approve them.')}<Msg>{a.err}</Msg><p className="text-sm mt-2" style={{ color: 'var(--mute)' }}>If both are off, users see: "Online payment is temporarily unavailable. Please contact support."</p></Card>;
}
