import React, { useState } from 'react';
import { call, money, date, FEATURE_LABELS } from '../lib/api.js';
import { Card, Field, Btn, Msg, Chip, Tabs, useAction, useLoad } from '../components/ui.jsx';

const remainingText = (r = {}) => Object.entries(r).map(([k, v]) => `${v} left ${{ today: 'today', month: 'this month', total: 'in your free trial' }[k]}`).join(' · ') || 'No usage limits';

export default function Account({ session, onLogout, goto, onChanged }) {
  const [tab, setTab] = useState('profile');
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-3">Account</h1>
      <Tabs value={tab} onChange={setTab} tabs={[['profile', 'Profile'], ['subscription', 'Subscription'], ['payments', 'Payment history'], ['usage', 'Usage'], ['security', 'Security'], ['support', 'Support']]} />
      {tab === 'profile' && <Card title="Profile"><p>{session.user.name || 'No name set'}</p><p style={{ color: 'var(--mute)' }}>{session.user.email}</p><p className="mt-2"><Chip tone={session.user.emailVerified ? 'ok' : 'bad'}>{session.user.emailVerified ? 'Email verified' : 'Email not verified'}</Chip></p><Btn className="mt-4" onClick={onLogout}>Log out</Btn></Card>}
      {tab === 'subscription' && <Subscription session={session} goto={goto} />}
      {tab === 'payments' && <Payments />}
      {tab === 'usage' && <Card title="Usage"><p>{remainingText(session.remaining)}</p><ul className="text-sm mt-3 list-disc pl-5">{Object.entries(session.entitlement.features).filter(([, v]) => v).map(([k]) => <li key={k}>{FEATURE_LABELS[k] || k}</li>)}</ul>{session.pendingSync > 0 && <p className="text-sm mt-3" style={{ color: 'var(--mute)' }}>{session.pendingSync} offline job(s) will sync when you are online.</p>}<Btn className="mt-3" onClick={onChanged}>Refresh</Btn></Card>}
      {tab === 'security' && <Security session={session} onChanged={onChanged} onLogout={onLogout} />}
      {tab === 'support' && <Support goto={goto} />}
    </div>
  );
}
function Subscription({ session, goto }) {
  const e = session.entitlement; const { data } = useLoad(() => call('GET', '/api/subscriptions/mine'));
  return (<div className="grid gap-4"><Card title="Current plan"><p className="text-lg">{e.planName || 'No active plan'}</p>
    <p style={{ color: 'var(--mute)' }}>{e.source === 'NONE' ? (e.trialExpired ? 'Your free trial has ended.' : 'Choose a plan to continue.') : e.lifetime ? 'Lifetime access. No expiry.' : e.endsAt ? `${e.source === 'FREE' ? 'Trial ends' : 'Renews or expires'} ${date(e.endsAt)}` : ''}</p><Btn primary className="mt-3" onClick={() => goto('pricing')}>{e.source === 'NONE' ? 'Choose a plan' : 'Change or renew plan'}</Btn></Card>
    <Card title="History">{data && data.subscriptions.length === 0 && <p style={{ color: 'var(--mute)' }}>No subscriptions yet.</p>}{data && data.subscriptions.map((s) => <div key={s._id} className="py-2 flex justify-between text-sm" style={{ borderTop: '1px solid var(--line)' }}><span>{s.planSnapshot ? s.planSnapshot.name : 'Plan'} · {s.paymentMethod}</span><span><Chip tone={s.status === 'ACTIVE' ? 'ok' : undefined}>{s.status}</Chip> {s.isLifetime ? 'lifetime' : `${date(s.startsAt)} → ${date(s.endsAt)}`} · {money(s.finalPriceMinor || 0, s.currency)}</span></div>)}</Card></div>);
}
function Payments() {
  const { data, err } = useLoad(() => call('GET', '/api/payments/mine')); const rows = data ? [...data.ssl.map((p) => ({ id: p._id, ref: p.tranId, amt: p.amountMinor, cur: p.currency, st: p.status, at: p.paidAt || p.createdAt, kind: 'Online' })), ...data.manual.map((p) => ({ id: p._id, ref: p.transactionId, amt: p.amountMinor, cur: p.currency, st: p.status, at: p.submittedAt, kind: 'Manual', note: p.adminNote }))].sort((a, b) => new Date(b.at) - new Date(a.at)) : [];
  return <Card title="Payment history"><Msg>{err}</Msg>{data && rows.length === 0 && <p style={{ color: 'var(--mute)' }}>No payments yet.</p>}{rows.map((r) => <div key={r.id} className="py-2 flex justify-between text-sm" style={{ borderTop: '1px solid var(--line)' }}><span>{r.kind} · {r.ref}</span><span>{money(r.amt, r.cur)} · <Chip tone={['PAID', 'APPROVED'].includes(r.st) ? 'ok' : ['FAILED', 'REJECTED'].includes(r.st) ? 'bad' : undefined}>{r.st}</Chip> · {date(r.at)}</span></div>)}</Card>;
}
function Security({ session, onChanged, onLogout }) {
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const a = useAction(); const t = useAction();
  const change = async (e) => { e.preventDefault(); if (await a.run(() => call('POST', '/api/auth/change-password', { currentPassword: cur, newPassword: next }))) { await onLogout(); } };
  return (<div className="grid gap-4"><Card title="Change password"><form onSubmit={change} className="grid gap-3 max-w-sm"><Field label="Current password"><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field><Field label="New password" hint="At least 10 characters, letters and numbers. You will be signed out everywhere."><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field><Msg>{a.err}</Msg><Btn primary type="submit" disabled={a.busy}>Change password</Btn></form></Card>
    <Card title="Two-step sign-in"><p className="text-sm mb-3" style={{ color: 'var(--mute)' }}>Get a code by email each time you sign in.</p><Btn disabled={t.busy} onClick={() => t.run(async () => { await call('POST', '/api/auth/two-factor', { enabled: !session.user.twoFactorEnabled }); await onChanged(); })}>{session.user.twoFactorEnabled ? 'Turn off' : 'Turn on'}</Btn><Msg>{t.err}</Msg></Card></div>);
}
function Support({ goto }) {
  const { data } = useLoad(() => call('GET', '/api/bugs/mine'));
  return <Card title="Support and bug reports"><div className="flex gap-2 mb-3"><Btn primary onClick={() => goto('bug')}>Report a bug</Btn><Btn onClick={() => goto('contact')}>Contact us</Btn></div>{data && data.bugs.map((b) => <div key={b._id} className="py-2 text-sm" style={{ borderTop: '1px solid var(--line)' }}><strong>{b.reportId}</strong> {b.title} <Chip>{b.status}</Chip>{b.replies && b.replies.map((r, i) => <p key={i} className="mt-1 pl-3" style={{ color: 'var(--mute)' }}>Support: {r.message}</p>)}</div>)}</Card>;
}
