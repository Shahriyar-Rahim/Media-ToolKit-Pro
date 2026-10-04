import React, { useEffect, useRef, useState } from 'react';
import { call, money, FEATURE_LABELS } from '../lib/api.js';
import { Card, Field, Btn, Msg, Chip, useAction, useLoad } from '../components/ui.jsx';

const limitText = (l = {}) => [l.dailyJobs != null && `${l.dailyJobs} jobs/day`, l.monthlyJobs != null && `${l.monthlyJobs} jobs/month`, l.maxFileSizeMB != null && `files up to ${l.maxFileSizeMB} MB`].filter(Boolean);

export default function Pricing({ session, goto, onChanged }) {
  const plans = useLoad(() => call('GET', '/api/plans'));
  const methods = useLoad(() => call('GET', '/api/payments/methods'));
  const [sel, setSel] = useState(null);
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Plans and pricing</h1>
      <p className="mb-4" style={{ color: 'var(--mute)' }}>Prices are set by the server and shown at checkout.</p>
      <Msg>{plans.err}</Msg>
      {plans.data && plans.data.plans.length === 0 && <Card>No plans are available right now. Please check back soon or contact support.</Card>}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.data && plans.data.plans.map((p) => (
          <Card key={p._id} className={sel && sel._id === p._id ? 'ring-2' : ''}>
            <h2 className="text-lg font-semibold">{p.name}</h2><p className="text-2xl my-2">{p.priceMinor === 0 ? 'Free' : money(p.priceMinor, p.currency)}<span className="text-sm" style={{ color: 'var(--mute)' }}> {p.isLifetime ? 'one-time, lifetime' : `/ ${p.billingPeriodDays} days`}</span></p>
            {p.description && <p className="text-sm mb-2" style={{ color: 'var(--mute)' }}>{p.description}</p>}
            <ul className="text-sm mb-3 list-disc pl-5">{Object.entries(p.entitlements.features || {}).filter(([, v]) => v).map(([k]) => <li key={k}>{FEATURE_LABELS[k] || k}</li>)}{limitText(p.entitlements.limits).map((t) => <li key={t}>{t}</li>)}</ul>
            <Btn primary className="w-full" onClick={() => (session && session.signedIn ? setSel(p) : goto('login'))}>{session && session.signedIn ? 'Choose plan' : 'Log in to choose'}</Btn>
          </Card>))}
      </div>
      {sel && methods.data && <Checkout key={sel._id} plan={sel} methods={methods.data} onChanged={onChanged} onClose={() => setSel(null)} />}
    </div>
  );
}

function Checkout({ plan, methods, onChanged, onClose }) {
  const [code, setCode] = useState(''); const [quote, setQuote] = useState(null); const [method, setMethod] = useState(''); const [manual, setManual] = useState(null); const [waiting, setWaiting] = useState(false); const [done, setDone] = useState('');
  const a = useAction(); const poll = useRef(null);
  const priceLine = async () => { const q = await a.run(() => call('POST', '/api/subscriptions/quote', { planId: plan._id, discountCode: code || undefined })); if (q) setQuote(q); };
  useEffect(() => { priceLine(); return () => clearInterval(poll.current); }, []); // eslint-disable-line
  const free = quote && quote.finalPriceMinor === 0;
  const body = (extra = {}) => ({ planId: plan._id, discountCode: code || undefined, ...extra });

  const watch = () => { // the browser tab can be closed at any time; the server + IPN decide, we just poll
    setWaiting(true); let n = 0;
    poll.current = setInterval(async () => { n++; const s = await window.mediaAPI.authRefresh(); if (s.entitlement && s.entitlement.planName === plan.name && s.entitlement.source === 'SUBSCRIPTION') { clearInterval(poll.current); setWaiting(false); setDone('Payment confirmed. Your plan is active.'); onChanged(); } if (n > 150) { clearInterval(poll.current); setWaiting(false); } }, 4000);
  };
  const go = async () => {
    if (free) { const r = await a.run(() => call('POST', '/api/subscriptions/checkout', body())); if (r && r.activated) { setDone('Your plan is active.'); onChanged(); } return; }
    if (method === 'SSLCOMMERZ') { const r = await a.run(() => call('POST', '/api/subscriptions/checkout', body({ method: 'SSLCOMMERZ' }))); if (r && r.redirectUrl) { await window.mediaAPI.openCheckout(r.redirectUrl); watch(); } }
    else if (method) { const r = await a.run(() => call('POST', '/api/subscriptions/checkout', body({ method: 'MFS', providerId: method }))); if (r && r.manual) setManual(r); }
  };
  return (
    <Card title={`Checkout: ${plan.name}`} className="mt-6">
      {done ? <Msg kind="ok">{done}</Msg> : <>
        <div className="flex gap-2 items-end mb-3"><Field label="Discount code (optional)"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field><Btn onClick={priceLine} disabled={a.busy}>Apply</Btn></div>
        <Msg>{a.err}</Msg>
        {quote && <dl className="text-sm mb-4 grid grid-cols-2 gap-1 max-w-xs"><dt>Price</dt><dd>{money(quote.originalPriceMinor, quote.currency)}</dd>{quote.discountMinor > 0 && <><dt>Discount {quote.discountCode}</dt><dd>-{money(quote.discountMinor, quote.currency)}</dd></>}<dt className="font-semibold">Total</dt><dd className="font-semibold">{money(quote.finalPriceMinor, quote.currency)}</dd></dl>}
        {quote && !free && !manual && (methods.message ? <Msg>{methods.message}</Msg> : <fieldset className="mb-4"><legend className="text-sm mb-2">Payment method</legend>
          {methods.sslcommerz && <label className="block mb-1"><input type="radio" name="m" checked={method === 'SSLCOMMERZ'} onChange={() => setMethod('SSLCOMMERZ')} /> Pay online (cards, mobile banking via SSLCommerz)</label>}
          {methods.mfs && methods.providers.map((p) => <label key={p._id} className="block mb-1"><input type="radio" name="m" checked={method === p._id} onChange={() => setMethod(p._id)} /> {p.name} (manual, reviewed by an admin)</label>)}</fieldset>)}
        {quote && !manual && !waiting && <Btn primary onClick={go} disabled={a.busy || (!free && !method)}>{free ? 'Activate plan' : method === 'SSLCOMMERZ' ? 'Continue to payment' : 'Continue'}</Btn>}
        {waiting && <p role="status">Waiting for your payment to be confirmed. Finish paying in your browser; this updates by itself. <Btn onClick={() => { clearInterval(poll.current); setWaiting(false); }}>Stop waiting</Btn></p>}
        {manual && <ManualPay plan={plan} code={code} manual={manual} onDone={() => setDone('Submitted. An admin will review your payment and your plan activates once approved.')} />}
      </>}
      <div className="mt-3"><Btn onClick={onClose}>Close</Btn></div>
    </Card>
  );
}

function ManualPay({ plan, code, manual, onDone }) {
  const [f, setF] = useState({ transactionId: '', senderNumber: '', amount: manual.amountMinor / 100, note: '' }); const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async (e) => { e.preventDefault(); if (await a.run(() => call('POST', '/api/manual-payments', { planId: plan._id, providerId: manual.provider.id, discountCode: code || undefined, transactionId: f.transactionId, senderNumber: f.senderNumber, amount: Number(f.amount), note: f.note || undefined }))) onDone(); };
  return (
    <div>
      <div className="panel p-3 mb-3 text-sm"><p>Send <strong>{money(manual.amountMinor, manual.currency)}</strong> to <strong>{manual.provider.accountNumber}</strong> ({manual.provider.name}, {manual.provider.accountType.toLowerCase()}).</p>{manual.provider.instructions && <p className="mt-1" style={{ color: 'var(--mute)' }}>{manual.provider.instructions}</p>}</div>
      <form onSubmit={send} className="grid gap-3 max-w-md"><Field label="Transaction ID"><input value={f.transactionId} onChange={set('transactionId')} required /></Field><Field label="Number you sent from"><input value={f.senderNumber} onChange={set('senderNumber')} inputMode="tel" required /></Field><Field label="Amount sent"><input type="number" step="0.01" value={f.amount} onChange={set('amount')} required /></Field><Field label="Note (optional)"><input value={f.note} onChange={set('note')} maxLength={300} /></Field><Msg>{a.err}</Msg><Btn primary type="submit" disabled={a.busy}>Submit for review</Btn></form>
    </div>
  );
}
