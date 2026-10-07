import React, { useEffect, useRef, useState } from 'react';
import { Crown, Check, X } from 'lucide-react';
import { call, money, date, FEATURE_LABELS } from '../lib/api.js';
import { Card, Field, Btn, Msg, Chip, useAction, useLoad } from '../components/ui.jsx';

const limitText = (l = {}) => [l.dailyJobs != null && `${l.dailyJobs} jobs/day`, l.monthlyJobs != null && `${l.monthlyJobs} jobs/month`, l.maxFileSizeMB != null && `files up to ${l.maxFileSizeMB} MB`].filter(Boolean);
const featureList = (p) => Object.entries(p.entitlements.features || {}).filter(([, v]) => v).map(([k]) => FEATURE_LABELS[k] || k);
const usageText = (r = {}) => Object.entries(r).map(([k, v]) => `${v} left ${{ today: 'today', month: 'this month', total: 'in your trial' }[k]}`).join(' · ');

export default function Pricing({ session, goto, onChanged }) {
  const plans = useLoad(() => call('GET', '/api/plans'));
  const methods = useLoad(() => call('GET', '/api/payments/methods'));
  const signedIn = !!(session && session.signedIn); const e = signedIn ? session.entitlement : null;
  const hasPlan = !!e && e.source === 'SUBSCRIPTION';
  const [showPlans, setShowPlans] = useState(!hasPlan); const [sel, setSel] = useState(null);
  useEffect(() => { if (!hasPlan) setShowPlans(true); }, [hasPlan]);
  const showGrid = !hasPlan || showPlans;
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">{showGrid ? 'Plans and pricing' : 'Your subscription'}</h1>
      <p className="mb-4" style={{ color: 'var(--mute)' }}>{showGrid ? 'Prices are set by the server and shown again at checkout.' : 'You can upgrade or renew whenever you like.'}</p>
      <Msg>{plans.err}</Msg>
      {hasPlan && !showPlans && <CurrentPlan e={e} remaining={session.remaining} onUpgrade={() => setShowPlans(true)} />}
      {showGrid && <>
        {hasPlan && <Btn className="mb-4" onClick={() => setShowPlans(false)}>← Back to my plan</Btn>}
        {plans.data && plans.data.plans.length === 0 && <Card>No plans are available right now. Please check back soon or contact support.</Card>}
        <div className="grid gap-4 md:grid-cols-3">
          {plans.data && plans.data.plans.map((p) => {
            const current = hasPlan && p.name === e.planName;
            return (
              <Card key={p._id}>
                <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{p.name}</h2>{current && <Chip tone="ok">Current plan</Chip>}</div>
                <p className="text-2xl my-2">{p.priceMinor === 0 ? 'Free' : money(p.priceMinor, p.currency)}<span className="text-sm" style={{ color: 'var(--mute)' }}> {p.isLifetime ? 'one-time, lifetime' : `/ ${p.billingPeriodDays} days`}</span></p>
                {p.description && <p className="text-sm mb-2" style={{ color: 'var(--mute)' }}>{p.description}</p>}
                <ul className="text-sm mb-3 list-disc pl-5">{featureList(p).map((t) => <li key={t}>{t}</li>)}{limitText(p.entitlements.limits).map((t) => <li key={t}>{t}</li>)}</ul>
                <Btn primary className="w-full" onClick={() => (signedIn ? setSel(p) : goto('login'))}>{!signedIn ? 'Log in to choose' : current ? 'Renew this plan' : hasPlan ? 'Upgrade to this plan' : 'Choose plan'}</Btn>
              </Card>);
          })}
        </div>
      </>}
      {sel && methods.data && <CheckoutDialog key={sel._id} plan={sel} methods={methods.data} onChanged={onChanged} onClose={() => setSel(null)} />}
    </div>
  );
}

function CurrentPlan({ e, remaining, onUpgrade }) {
  const left = e.endsAt ? Math.max(0, Math.ceil((new Date(e.endsAt) - Date.now()) / 864e5)) : null; const use = usageText(remaining);
  return (
    <Card>
      <div className="flex items-center gap-2"><Crown size={20} style={{ color: 'var(--accent)' }} /><h2 className="text-lg font-semibold">{e.planName}</h2><Chip tone="ok">Active</Chip></div>
      <p className="mt-2">{e.lifetime ? 'Lifetime access. It never expires.' : `Active until ${date(e.endsAt)}${left != null ? ` (${left} day${left === 1 ? '' : 's'} left)` : ''}`}</p>
      {use && <p className="text-sm mt-1" style={{ color: 'var(--mute)' }}>{use}</p>}
      <ul className="text-sm mt-3 mb-4 grid gap-1 md:grid-cols-2">{Object.entries(e.features || {}).filter(([, v]) => v).map(([k]) => <li key={k}><Check size={12} className="inline mr-1" />{FEATURE_LABELS[k] || k}</li>)}</ul>
      <Btn primary onClick={onUpgrade}>{e.lifetime ? 'View other plans' : 'Upgrade'}</Btn>
    </Card>
  );
}

const STEPS = ['Plan', 'Payment method', 'Pay', 'Done'];
function Stepper({ step }) {
  return <ol aria-label="Checkout steps" className="flex flex-wrap gap-2 text-xs mb-4">{STEPS.map((s, i) => <li key={s} aria-current={step === i + 1 ? 'step' : undefined} className="px-2 py-1 rounded" style={{ border: '1px solid var(--line)', background: step === i + 1 ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'none', color: step >= i + 1 ? 'var(--ink)' : 'var(--mute)' }}>{i + 1}. {s}</li>)}</ol>;
}

// A centred dialog that walks through: 1 plan + discount -> 2 payment method -> 3 pay (instructions or the payment window) -> 4 done.
function CheckoutDialog({ plan, methods, onChanged, onClose }) {
  const [step, setStep] = useState(1); const [code, setCode] = useState(''); const [quote, setQuote] = useState(null); const [method, setMethod] = useState('');
  const [manual, setManual] = useState(null); const [order, setOrder] = useState(null); const [done, setDone] = useState(null);
  const a = useAction(); const poll = useRef(null); const title = useRef(null);
  const free = !!quote && quote.finalPriceMinor === 0; const body = (extra = {}) => ({ planId: plan._id, discountCode: code || undefined, ...extra });
  const priceLine = async () => { const q = await a.run(() => call('POST', '/api/subscriptions/quote', { planId: plan._id, discountCode: code || undefined })); if (q) setQuote(q); };
  useEffect(() => {
    priceLine(); const onKey = (ev) => { if (ev.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); clearInterval(poll.current); };
  }, []); // eslint-disable-line
  useEffect(() => { if (title.current) title.current.focus(); }, [step]);

  const finishActive = () => { clearInterval(poll.current); setDone({ kind: 'active' }); setStep(4); onChanged(); };
  const checkNow = async () => { const s = await window.mediaAPI.authRefresh(); if (s.entitlement && s.entitlement.planName === plan.name && s.entitlement.source === 'SUBSCRIPTION') { finishActive(); return true; } return false; };
  const watch = () => { let n = 0; clearInterval(poll.current); poll.current = setInterval(async () => { n++; if ((await checkNow()) || n > 150) clearInterval(poll.current); }, 4000); }; // the browser tab may be closed any time; the server decides, we only poll
  const activateFree = async () => { const r = await a.run(() => call('POST', '/api/subscriptions/checkout', body())); if (r && r.activated) finishActive(); };
  const proceed = async () => {
    if (method === 'SSLCOMMERZ') { const r = await a.run(() => call('POST', '/api/subscriptions/checkout', body({ method: 'SSLCOMMERZ' }))); if (r && r.redirectUrl) { await window.mediaAPI.openCheckout(r.redirectUrl); setOrder(r.orderId || null); setStep(3); watch(); } }
    else { const r = await a.run(() => call('POST', '/api/subscriptions/checkout', body({ method: 'MFS', providerId: method }))); if (r && r.manual) { setManual(r); setStep(3); } }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="co-title" className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.55)', zIndex: 50 }} onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="panel w-full max-w-xl p-5" style={{ maxHeight: '92vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div className="flex items-start justify-between mb-2"><h2 id="co-title" ref={title} tabIndex={-1} className="text-lg font-semibold" style={{ outline: 'none' }}>Checkout</h2><button className="btn" aria-label="Close checkout" onClick={onClose}><X size={14} /></button></div>
        <Stepper step={step} />

        {step === 1 && <>
          <div className="panel p-3 mb-3"><div className="flex justify-between"><strong>{plan.name}</strong><span>{plan.priceMinor === 0 ? 'Free' : money(plan.priceMinor, plan.currency)} <span className="text-xs" style={{ color: 'var(--mute)' }}>{plan.isLifetime ? 'lifetime' : `/ ${plan.billingPeriodDays} days`}</span></span></div>
            {plan.description && <p className="text-sm mt-1" style={{ color: 'var(--mute)' }}>{plan.description}</p>}
            <ul className="text-sm mt-2 list-disc pl-5">{featureList(plan).map((t) => <li key={t}>{t}</li>)}</ul></div>
          <div className="flex gap-2 items-end mb-3"><Field label="Discount code (optional)"><input value={code} onChange={(ev) => setCode(ev.target.value.toUpperCase())} /></Field><Btn onClick={priceLine} disabled={a.busy}>Apply</Btn></div>
          <Msg>{a.err}</Msg>
          {quote && <dl className="text-sm mb-4 grid grid-cols-2 gap-1 max-w-xs"><dt>Price</dt><dd>{money(quote.originalPriceMinor, quote.currency)}</dd>{quote.discountMinor > 0 && <><dt>Discount {quote.discountCode}</dt><dd>-{money(quote.discountMinor, quote.currency)}</dd></>}<dt className="font-semibold">Total</dt><dd className="font-semibold">{money(quote.finalPriceMinor, quote.currency)}</dd></dl>}
          <div className="flex gap-2"><Btn primary disabled={!quote || a.busy} onClick={free ? activateFree : () => setStep(2)}>{free ? 'Activate plan' : 'Continue'}</Btn><Btn onClick={onClose}>Cancel</Btn></div>
        </>}

        {step === 2 && <>
          <p className="text-sm mb-3">{plan.name} · Total <strong>{quote ? money(quote.finalPriceMinor, quote.currency) : ''}</strong></p>
          {methods.message ? <Msg>{methods.message}</Msg> : <fieldset className="mb-4"><legend className="text-sm mb-2">How would you like to pay?</legend>
            {methods.sslcommerz && <label className="panel p-3 mb-2 block cursor-pointer"><input type="radio" name="m" checked={method === 'SSLCOMMERZ'} onChange={() => setMethod('SSLCOMMERZ')} /> <strong>Pay online</strong> <span className="text-sm" style={{ color: 'var(--mute)' }}>cards and mobile banking through SSLCommerz. Activates automatically.</span></label>}
            {methods.mfs && methods.providers.map((p) => <label key={p._id} className="panel p-3 mb-2 block cursor-pointer"><input type="radio" name="m" checked={method === p._id} onChange={() => setMethod(p._id)} /> <strong>{p.name}</strong> <span className="text-sm" style={{ color: 'var(--mute)' }}>manual payment. An admin checks it, then your plan activates.</span></label>)}</fieldset>}
          <Msg>{a.err}</Msg>
          <div className="flex gap-2"><Btn onClick={() => setStep(1)}>Back</Btn><Btn primary disabled={!method || a.busy} onClick={proceed}>{method === 'SSLCOMMERZ' ? 'Continue to secure payment' : 'Continue'}</Btn></div>
        </>}

        {step === 3 && manual && <ManualPay plan={plan} code={code} manual={manual} onBack={() => { setManual(null); setStep(2); }} onDone={(r) => { setDone({ kind: 'pending', orderId: r.orderId }); setStep(4); }} />}
        {step === 3 && !manual && <div>
          <p role="status" className="mb-2">Finish your payment in the browser window that just opened. This page updates by itself as soon as the payment is confirmed.</p>
          {order && <p className="text-sm mb-3">Order ID: <strong>{order}</strong></p>}<Msg>{a.err}</Msg>
          <div className="flex gap-2"><Btn onClick={() => a.run(async () => { if (!(await checkNow())) a.setErr('Not confirmed yet. If you have just paid, wait a few seconds and try again.'); })} disabled={a.busy}>I have paid, check now</Btn><Btn onClick={() => { clearInterval(poll.current); onClose(); }}>Stop waiting</Btn></div>
        </div>}

        {step === 4 && done && <div className="text-center py-4">
          <Check size={36} style={{ color: 'var(--ok)' }} className="mx-auto mb-2" />
          {done.kind === 'active' ? <p className="text-lg font-semibold">Your {plan.name} plan is active.</p> : <><p className="text-lg font-semibold">Payment request received</p><p className="text-sm mt-1" style={{ color: 'var(--mute)' }}>It is now <strong>under review</strong>. We emailed you a confirmation, and you will get your memo as soon as an admin approves it.</p></>}
          {done.orderId && <p className="mt-3">Order ID: <strong>{done.orderId}</strong></p>}
          <Btn primary className="mt-4" onClick={onClose}>Done</Btn>
        </div>}
      </div>
    </div>
  );
}

function ManualPay({ plan, code, manual, onBack, onDone }) {
  const [f, setF] = useState({ transactionId: '', senderNumber: '', amount: manual.amountMinor / 100, note: '' }); const a = useAction(); const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async (e) => { e.preventDefault(); const r = await a.run(() => call('POST', '/api/manual-payments', { planId: plan._id, providerId: manual.provider.id, discountCode: code || undefined, transactionId: f.transactionId, senderNumber: f.senderNumber, amount: Number(f.amount), note: f.note || undefined })); if (r) onDone(r); };
  return (
    <div>
      <div className="panel p-3 mb-3 text-sm"><p>Send <strong>{money(manual.amountMinor, manual.currency)}</strong> to <strong>{manual.provider.accountNumber}</strong> ({manual.provider.name}, {manual.provider.accountType.toLowerCase()}).</p>{manual.provider.instructions && <p className="mt-1" style={{ color: 'var(--mute)' }}>{manual.provider.instructions}</p>}<p className="mt-2">Then enter the details of your payment below.</p></div>
      <form onSubmit={send} className="grid gap-3"><Field label="Transaction ID"><input value={f.transactionId} onChange={set('transactionId')} required /></Field><Field label="Number you sent from"><input value={f.senderNumber} onChange={set('senderNumber')} inputMode="tel" required /></Field><Field label="Amount sent"><input type="number" step="0.01" value={f.amount} onChange={set('amount')} required /></Field><Field label="Note (optional)"><input value={f.note} onChange={set('note')} maxLength={300} /></Field>
        <Msg>{a.err}</Msg><div className="flex gap-2"><Btn type="button" onClick={onBack}>Back</Btn><Btn primary type="submit" disabled={a.busy}>Submit for review</Btn></div></form>
    </div>
  );
}
