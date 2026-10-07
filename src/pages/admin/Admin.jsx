import React, { useState } from 'react';
import { call, money, date, FEATURE_LABELS } from '../../lib/api.js';
import { Card, Field, Btn, Msg, Chip, Tabs, DataTable, useAction, useLoad } from '../../components/ui.jsx';
import { SettingsEditor, GatewayToggles } from './Settings.jsx';
import { PlanEditor, DiscountEditor, MfsEditor, FaqEditor } from './Editors.jsx';

const TABS = [['dashboard', 'Dashboard'], ['users', 'Users'], ['plans', 'Plans'], ['discounts', 'Discounts'], ['payments', 'Payments'], ['mfs', 'MFS'], ['gateways', 'Gateways'], ['settings', 'Settings'], ['faq', 'Help/FAQ'], ['support', 'Support'], ['audit', 'Audit log']];

export default function Admin({ me }) {
  const [tab, setTab] = useState('dashboard');
  return (<div><h1 className="text-xl font-semibold mb-3">Admin</h1><Tabs tabs={TABS} value={tab} onChange={setTab} />
    {tab === 'dashboard' && <Dashboard />}{tab === 'users' && <Users />}{tab === 'plans' && <PlanEditor />}{tab === 'discounts' && <DiscountEditor />}{tab === 'payments' && <Payments />}
    {tab === 'mfs' && <MfsEditor />}{tab === 'gateways' && <GatewayToggles />}{tab === 'settings' && <SettingsEditor />}{tab === 'faq' && <FaqEditor />}{tab === 'support' && <Support me={me} />}
    {tab === 'audit' && <DataTable path="/api/admin/audit" columns={[{ h: 'When', render: (r) => new Date(r.at).toLocaleString() }, { h: 'Action', render: (r) => r.action }, { h: 'Target', render: (r) => `${r.targetType || ''} ${r.targetId || ''}` }, { h: 'Actor', render: (r) => r.actorId || '—' }, { h: 'IP', render: (r) => r.ip || '—' }]} />}</div>);
}

function Dashboard() {
  const { data, err } = useLoad(() => call('GET', '/api/admin/dashboard')); const rep = useLoad(() => call('GET', '/api/admin/reports'));
  if (err) return <Msg>{err}</Msg>; if (!data) return <p>Loading…</p>;
  const stat = (t, v) => <div key={t} className="panel p-3"><div className="text-2xl font-semibold">{v}</div><div className="text-xs" style={{ color: 'var(--mute)' }}>{t}</div></div>;
  return (<div className="grid gap-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Total users', data.users], ['Active users (30d)', data.activeUsers30d], ['Active subscriptions', data.activeSubs], ['Expired subscriptions', data.expiredSubs], ['Pending manual payments', data.pendingManual], ['Online payments (paid)', data.sslPaid], ['Active plans', data.activePlans], ['Open bug reports', data.openBugs], ['Open contact messages', data.openContacts], ['Revenue', Object.entries(data.revenueMinor).map(([c, v]) => money(v, c)).join(', ') || '0'], ['Refunded', Object.entries(data.refundedMinor || {}).map(([c, v]) => money(v, c)).join(', ') || '0']].map(([t, v]) => stat(t, v))}</div>
    <div className="grid md:grid-cols-2 gap-4"><Card title="Plan popularity">{data.popularPlans.length === 0 && <p style={{ color: 'var(--mute)' }}>No subscriptions yet.</p>}{data.popularPlans.map((p) => <div key={p._id} className="flex justify-between text-sm py-1"><span>{p._id}</span><span>{p.n}</span></div>)}</Card>
      <Card title="Reports">{rep.data && <div className="text-sm grid gap-1"><div>Free operations used: {rep.data.freeOperations}</div><div>Failed/cancelled payments: {rep.data.failedPayments}</div>{rep.data.byMethod.map((m) => <div key={m._id}>{m._id}: {m.n} subscriptions</div>)}</div>}</Card></div>
    <Card title="Recent activity">{data.recent.map((r) => <div key={r._id} className="text-sm py-1" style={{ borderTop: '1px solid var(--line)' }}>{new Date(r.at).toLocaleString()} · {r.action}</div>)}</Card></div>);
}

function Users() {
  const [open, setOpen] = useState(null); const [k, setK] = useState(0);
  return (<div><DataTable refreshKey={k} path="/api/admin/users" filters={['disabled', 'unverified']} columns={[{ h: 'Email', render: (r) => r.email }, { h: 'Role', render: (r) => r.role }, { h: 'Status', render: (r) => r.disabledAt ? <Chip tone="bad">disabled</Chip> : r.emailVerifiedAt ? <Chip tone="ok">active</Chip> : <Chip>unverified</Chip> }, { h: 'Last login', render: (r) => date(r.lastLoginAt) }, { h: '', render: (r) => <Btn onClick={() => setOpen(r._id)}>Open</Btn> }]} />
    {open && <UserDetail id={open} onClose={() => { setOpen(null); setK(k + 1); }} />}</div>);
}
// Loopback means the person is using the server's own computer (typical while testing).
const ipLabel = (ip) => (!ip ? 'unknown' : ip === '127.0.0.1' ? '127.0.0.1 (this computer)' : ip);
function UserDetail({ id, onClose }) {
  const { data, err, reload } = useLoad(() => call('GET', `/api/admin/users/${id}`), [id]); const plans = useLoad(() => call('GET', '/api/admin/plans')); const a = useAction(); const [pid, setPid] = useState('');
  if (!data) return <Card className="mt-4"><Msg>{err}</Msg>Loading…</Card>; const u = data.user, e = data.entitlement;
  return (<Card title={u.email} className="mt-4"><p className="text-sm" style={{ color: 'var(--mute)' }}>{u.role} · joined {date(u.createdAt)}</p>
    <p className="text-sm mt-1">Last login: {date(u.lastLoginAt)} from <strong>{ipLabel(u.lastLoginIp)}</strong> · Last seen: {date(u.lastSeenAt)} from <strong>{ipLabel(u.lastSeenIp)}</strong></p>
    {(u.sessions || []).length > 0 && <details className="text-sm mt-1"><summary className="cursor-pointer">Signed-in devices ({u.sessions.length})</summary>{u.sessions.map((s, i) => <p key={i} className="pl-3" style={{ color: 'var(--mute)' }}>{(s.ua || 'Unknown device').slice(0, 70)} · {ipLabel(s.ip)} · {date(s.createdAt)}</p>)}</details>}
    <p className="my-2 text-sm">Access: <strong>{e.planName || 'none'}</strong> ({e.source}) · used today {e.usage.today}, month {e.usage.month}, free total {e.usage.total}</p>
    <div className="flex flex-wrap gap-2 mb-3"><Btn disabled={a.busy} onClick={() => a.run(async () => { await call('POST', `/api/admin/users/${id}/${u.disabledAt ? 'enable' : 'disable'}`); reload(); })}>{u.disabledAt ? 'Enable account' : 'Disable account'}</Btn>
      <select aria-label="Plan to grant" value={pid} onChange={(e2) => setPid(e2.target.value)}><option value="">Grant plan…</option>{plans.data && plans.data.items.filter((p) => !p.archivedAt).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select><Btn disabled={!pid || a.busy} onClick={() => a.run(async () => { await call('POST', `/api/admin/users/${id}/grant`, { planId: pid }); setPid(''); reload(); })}>Grant</Btn></div>
    <div className="flex flex-wrap gap-2 mb-2"><Btn disabled={a.busy} onClick={() => window.confirm('Sign this user out everywhere and clear any login lockout?') && a.run(async () => { await call('POST', `/api/admin/users/${id}/reset-access`, { forcePasswordReset: false }); reload(); }, 'Access reset: all sessions ended and lockout cleared.')}>Reset access</Btn><Btn disabled={a.busy} onClick={() => window.confirm('Sign this user out and require a new password at their next login?') && a.run(async () => { await call('POST', `/api/admin/users/${id}/reset-access`, { forcePasswordReset: true }); reload(); }, 'Password reset required at next login.')}>Force password reset</Btn></div><Msg>{a.err}</Msg><Msg kind="ok">{a.ok}</Msg><h3 className="font-semibold mt-3">Subscriptions</h3>{data.subscriptions.map((s) => <div key={s._id} className="text-sm py-1 flex justify-between" style={{ borderTop: '1px solid var(--line)' }}><span>{s.planSnapshot && s.planSnapshot.name} · {s.paymentMethod} · <Chip tone={s.status === 'ACTIVE' ? 'ok' : undefined}>{s.status}</Chip> {s.isLifetime ? 'lifetime' : `→ ${date(s.endsAt)}`}</span>{s.status === 'ACTIVE' && <Btn onClick={() => window.confirm('Revoke this subscription?') && a.run(async () => { await call('POST', `/api/admin/subscriptions/${s._id}/revoke`, { reason: 'Revoked by admin' }); reload(); })}>Revoke</Btn>}</div>)}
    <h3 className="font-semibold mt-3">Payments</h3>{[...data.payments.ssl.map((p) => [p._id, `Online ${p.tranId}`, p.amountMinor, p.currency, p.status]), ...data.payments.manual.map((p) => [p._id, `Manual ${p.transactionId}`, p.amountMinor, p.currency, p.status])].map(([k, ref, amt, cur, st]) => <div key={k} className="text-sm py-1" style={{ borderTop: '1px solid var(--line)' }}>{ref} · {money(amt, cur)} · {st}</div>)}
    <Btn className="mt-3" onClick={onClose}>Close</Btn></Card>);
}

function Payments() {
  const [t, setT] = useState('manual'); const [k, setK] = useState(0); const a = useAction(); const [note, setNote] = useState({});
  const [refund, setRefund] = useState(null);
  // The table is refreshed whether or not the reply arrived: the server may have finished the action even if the answer was lost.
  const review = (id, approve) => a.run(async () => { try { await call('POST', `/api/admin/payments/manual/${id}/review`, { approve, note: note[id] || undefined }); } finally { setK((x) => x + 1); } }, approve ? 'Approved. The customer is being emailed their memo.' : 'Rejected. The customer has been notified.');
  return (<div><Tabs value={t} onChange={setT} tabs={[['manual', 'Manual MFS'], ['ssl', 'SSLCommerz']]} /><Msg>{a.err}</Msg><Msg kind="ok">{a.ok}</Msg>
    {t === 'manual' ? <DataTable refreshKey={k} path="/api/admin/payments/manual" filters={['PENDING', 'APPROVED', 'REJECTED', 'REFUNDED']} columns={[{ h: 'Order', render: (r) => r.orderId || '—' }, { h: 'User', render: (r) => r.userId && (r.userId.name ? `${r.userId.name} (${r.userId.email})` : r.userId.email) }, { h: 'Plan', render: (r) => r.planId && r.planId.name }, { h: 'Discount', render: (r) => (r.discountId ? (r.discountId.name ? `${r.discountId.name} (${r.discountId.code})` : r.discountId.code) : '—') }, { h: 'Via', render: (r) => r.providerId && r.providerId.name }, { h: 'Txn / sender', render: (r) => `${r.transactionId} · ${r.senderNumber}` }, { h: 'Paid vs expected', render: (r) => <span style={{ color: r.amountMinor === r.expectedMinor ? undefined : 'var(--danger)' }}>{money(r.amountMinor, r.currency)} / {money(r.expectedMinor, r.currency)}</span> }, { h: 'Status', render: (r) => <Chip tone={r.status === 'APPROVED' ? 'ok' : r.status === 'REJECTED' ? 'bad' : undefined}>{r.status}</Chip> },
        { h: 'Review', render: (r) => r.status === 'APPROVED' ? <Btn onClick={() => setRefund({ kind: 'manual', row: r })}>Refund</Btn> : r.status === 'PENDING' ? <div className="grid gap-1"><input aria-label="Admin note" placeholder="Note (optional)" value={note[r._id] || ''} onChange={(e) => setNote({ ...note, [r._id]: e.target.value })} /><div className="flex gap-1"><Btn primary onClick={() => review(r._id, true)}>Approve</Btn><Btn onClick={() => review(r._id, false)}>Reject</Btn></div></div> : (r.refundReason || r.adminNote || '—') }]} />
      : <DataTable path="/api/admin/payments/ssl" filters={['INITIATED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDING', 'REFUNDED']} refreshKey={k} columns={[{ h: 'Order', render: (r) => r.orderId || '—' }, { h: 'User', render: (r) => r.userId && r.userId.email }, { h: 'Transaction', render: (r) => r.tranId }, { h: 'Discount', render: (r) => (r.discountId ? (r.discountId.name || r.discountId.code) : '—') }, { h: 'Amount', render: (r) => money(r.amountMinor, r.currency) }, { h: 'Status', render: (r) => <Chip tone={r.status === 'PAID' ? 'ok' : ['FAILED', 'CANCELLED'].includes(r.status) ? 'bad' : undefined}>{r.status}</Chip> }, { h: 'Bank ref', render: (r) => r.bankTranId || '—' }, { h: 'Date', render: (r) => date(r.paidAt || r.createdAt) }, { h: 'Refund', render: (r) => ['PAID', 'REFUNDING'].includes(r.status) ? <Btn onClick={() => setRefund({ kind: 'ssl', row: r })}>{r.status === 'REFUNDING' ? 'Retry refund' : 'Refund'}</Btn> : (r.refundReason || '—') }]} />}
    {refund && <RefundBox key={refund.row._id} {...refund} onRefresh={() => setK((x) => x + 1)} onDone={() => setRefund(null)} onCancel={() => setRefund(null)} />}</div>);
}

function RefundBox({ kind, row, onDone, onCancel, onRefresh }) {
  const [reason, setReason] = useState(''); const [gw, setGw] = useState(true); const a = useAction();
  const amt = kind === 'ssl' ? money(row.amountMinor, row.currency) : money(row.expectedMinor, row.currency);
  const go = async () => { const ok = await a.run(() => call('POST', `/api/admin/payments/${kind}/${row._id}/refund`, kind === 'ssl' ? { reason, viaGateway: gw } : { reason })); onRefresh(); if (ok) onDone(); };
  return (<Card title="Refund payment" className="mt-4"><p className="text-sm">{row.userId && row.userId.email} · {row.tranId || row.transactionId} · <strong>{amt}</strong>{row.status === 'REFUNDING' && <> · <Chip tone="bad">refund unfinished</Chip></>}</p>
    <p className="text-sm my-2" style={{ color: 'var(--mute)' }}>This ends the customer's access from this purchase, gives back any discount use, and emails them. {kind === 'ssl' ? (gw ? 'The money is sent back through SSLCommerz.' : 'This app will not move any money. Use this only if you already refunded the customer yourself.') : 'This app cannot move money for manual payments. Send it back yourself (bKash, Nagad, etc.) and record it here.'}</p>
    <div className="grid gap-3 max-w-md"><Field label="Reason (kept in the audit log)"><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      {kind === 'ssl' && <label className="text-sm"><input type="checkbox" checked={gw} onChange={(e) => setGw(e.target.checked)} /> Refund through SSLCommerz</label>}<Msg>{a.err}</Msg>
      <div className="flex gap-2"><Btn primary disabled={reason.trim().length < 3 || a.busy} onClick={go}>{`Refund ${amt}`}</Btn><Btn onClick={onCancel}>Cancel</Btn></div></div></Card>);
}

function Support({ me }) {
  const [kind, setKind] = useState('bugs'); const [open, setOpen] = useState(null); const [k, setK] = useState(0);
  return (<div><Tabs value={kind} onChange={(v) => { setKind(v); setOpen(null); }} tabs={[['bugs', 'Bug reports'], ['contacts', 'Contact messages']]} />
    <DataTable refreshKey={k} path={`/api/admin/${kind}`} filters={kind === 'bugs' ? ['OPEN', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] : ['OPEN', 'RESOLVED', 'ARCHIVED']} columns={[{ h: 'ID', render: (r) => r.reportId || r.ticketId }, { h: 'Subject', render: (r) => r.title || r.subject }, { h: 'From', render: (r) => r.email || '—' }, { h: 'Status', render: (r) => <Chip>{r.status}</Chip> }, { h: 'Date', render: (r) => date(r.createdAt) }, { h: '', render: (r) => <Btn onClick={() => setOpen(r)}>Open</Btn> }]} />
    {open && <Thread kind={kind} item={open} me={me} onDone={() => { setOpen(null); setK(k + 1); }} />}</div>);
}
function Thread({ kind, item, me, onDone }) {
  const full = useLoad(() => call('GET', `/api/admin/${kind}/${item._id}`), [item._id]); const it = full.data || item; // list rows omit screenshots and logs
  const [msg, setMsg] = useState(''); const [status, setStatus] = useState(''); const a = useAction(); const opts = kind === 'bugs' ? ['OPEN', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] : ['OPEN', 'RESOLVED', 'ARCHIVED'];
  const assign = (id) => a.run(async () => { await call('PUT', `/api/admin/bugs/${item._id}/assign`, { assignedTo: id }); full.reload(); });
  return (<Card title={`${it.reportId || it.ticketId}: ${it.title || it.subject}`} className="mt-4"><p className="text-sm whitespace-pre-wrap">{it.description || it.message}</p>
    {kind === 'bugs' && <p className="text-xs mt-2" style={{ color: 'var(--mute)' }}>{it.severity} · {it.category} · v{it.appVersion || '?'} · {it.os || ''}{it.steps ? ` · Steps: ${it.steps}` : ''}</p>}
    {kind === 'bugs' && it.screenshot && <img src={it.screenshot} alt="Screenshot attached to the report" className="mt-3 max-w-full rounded" style={{ border: '1px solid var(--line)', maxHeight: 360 }} />}
    {kind === 'bugs' && it.logExcerpt && <details className="mt-3 text-xs"><summary className="cursor-pointer">Diagnostic log from the user</summary><pre className="overflow-auto max-h-60 p-2 mt-1" style={{ background: 'var(--bg)' }}>{it.logExcerpt}</pre></details>}
    {kind === 'bugs' && <p className="text-sm mt-3">{it.assignedTo ? (me && it.assignedTo === me.id ? 'Assigned to you' : 'Assigned to another admin') : 'Unassigned'} {me && it.assignedTo !== me.id && <Btn disabled={a.busy} onClick={() => assign(me.id)}>Assign to me</Btn>} {it.assignedTo && <Btn disabled={a.busy} onClick={() => assign(null)}>Unassign</Btn>}</p>}
    {(it.replies || []).map((r, i) => <p key={i} className="text-sm mt-2 pl-3" style={{ color: 'var(--mute)' }}>Reply: {r.message}</p>)}
    <div className="grid gap-2 mt-3 max-w-lg"><textarea aria-label="Reply" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 6, padding: 8 }} /><div className="flex gap-2"><select aria-label="Set status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Keep status</option>{opts.map((s) => <option key={s}>{s}</option>)}</select><Btn primary disabled={!msg || a.busy} onClick={async () => { if (await a.run(() => call('POST', `/api/admin/${kind}/${item._id}/reply`, { message: msg, status: status || undefined }))) onDone(); }}>Send reply (emails the user)</Btn><Btn disabled={!status || a.busy} onClick={async () => { if (await a.run(() => call('PUT', `/api/admin/${kind}/${item._id}/status`, { status }))) onDone(); }}>Only change status</Btn><Btn onClick={onDone}>Close</Btn></div><Msg>{a.err}</Msg></div></Card>);
}
