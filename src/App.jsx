import React, { useCallback, useEffect, useState } from 'react';
import { Home as HomeIcon, Video, Music, Image, FileText, Archive, Settings as Cog, Activity, CreditCard, HelpCircle, User, Shield, WifiOff } from 'lucide-react';
import ToolPage from './pages/ToolPage.jsx';
import Vault from './pages/Vault.jsx';
import Settings from './pages/Settings.jsx';
import JobList from './pages/JobList.jsx';
import Landing from './pages/Landing.jsx';
import Auth from './pages/Auth.jsx';
import Pricing from './pages/Pricing.jsx';
import Account from './pages/Account.jsx';
import Help, { Contact, BugReport } from './pages/Support.jsx';
import Admin from './pages/admin/Admin.jsx';
import { Btn, Card, Field, Msg, useAction } from './components/ui.jsx';
import { date, call, setReauthHandler } from './lib/api.js';

const NAV = [['home', 'Home', HomeIcon], ['video', 'Video', Video], ['audio', 'Audio', Music], ['images', 'Images', Image], ['pdf', 'PDF', FileText], ['queue', 'Queue', Activity], ['vault', 'Media Vault', Archive], ['pricing', 'Subscription', CreditCard], ['help', 'Help', HelpCircle], ['settings', 'Settings', Cog], ['account', 'Account', User]];
const TOOLS = [['video', 'Video', 'Compress, remux, rotate', Video], ['audio', 'Audio', 'Convert, compress, extract', Music], ['images', 'Images', 'HEIC and more to JPG', Image], ['pdf', 'PDF', 'Create and merge', FileText]];

function applyTheme(t) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still starting
  const [page, setPage] = useState('landing'); const [info, setInfo] = useState(null);
  const api = window.mediaAPI; const [reauth, setReauth] = useState(null); const reauthRef = React.useRef(null);
  useEffect(() => { setReauthHandler(() => reauthRef.current || (reauthRef.current = new Promise((resolve, reject) => setReauth({ resolve, reject })))); return () => setReauthHandler(null); }, []);
  const closeReauth = (ok, err) => { const r = reauth; reauthRef.current = null; setReauth(null); if (r) ok ? r.resolve() : r.reject(err || new Error('Confirmation cancelled.')); };

  useEffect(() => {
    if (!api) return;
    api.getSettings().then((s) => applyTheme(s.theme)); api.appInfo().then(setInfo);
    api.authBoot().then((s) => { setSession(s); setPage(s.signedIn ? 'home' : 'landing'); }).catch(() => setSession({ signedIn: false }));
    const mq = window.matchMedia('(prefers-color-scheme: dark)'); const on = () => api.getSettings().then((s) => s.theme === 'system' && applyTheme('system'));
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, []); // eslint-disable-line
  const refresh = useCallback(async () => { const s = await api.authRefresh(); setSession(s); return s; }, [api]);
  const onAuthed = useCallback(async () => { const s = await api.authBoot(); setSession(s); setPage(s.signedIn ? 'home' : 'landing'); }, [api]);
  const onLogout = useCallback(async () => { await api.logout(); setSession({ signedIn: false }); setPage('landing'); }, [api]);

  if (!api) return <p className="p-6">This app must run inside Media Toolkit Pro (Electron).</p>;
  if (session === undefined) return <p className="p-6" role="status">Starting…</p>;

  // ---------- signed out ----------
  if (!session.signedIn) {
    const back = <div className="p-4"><Btn onClick={() => setPage('landing')}>← Home</Btn></div>;
    return (<div className="h-full overflow-auto">
      {session.offlineNoCache && <p className="p-3 text-center text-sm" role="status" style={{ background: 'var(--panel)' }}>You are offline. Connect to the internet to sign in.</p>}
      {page === 'landing' && <Landing goto={setPage} />}
      {(page === 'login' || page === 'register') && <Auth key={page} start={page} goto={setPage} onAuthed={onAuthed} />}
      {page === 'pricing' && <>{back}<Pricing session={session} goto={setPage} onChanged={refresh} /></>}
      {page === 'help' && <>{back}<Help goto={setPage} /></>}
      {page === 'contact' && <>{back}<Contact session={session} /></>}
      {page === 'bug' && <>{back}<BugReport info={info} /></>}</div>);
  }

  // ---------- signed in ----------
  const e = session.entitlement; const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(session.user.role);
  const rem = Object.entries(session.remaining || {})[0];
  return (
    <div className="flex h-full">
      <nav aria-label="Main" className="w-56 p-3 flex flex-col gap-1 overflow-auto" style={{ borderRight: '1px solid var(--line)' }}>
        <div className="px-3 py-2 font-semibold">Media Toolkit Pro</div>
        {NAV.map(([id, label, Icon]) => <button key={id} className="nav" aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon size={16} />{label}</button>)}
        {isAdmin && <><div className="mt-3 px-3 text-xs" style={{ color: 'var(--mute)' }}>ADMINISTRATION</div><button className="nav" aria-current={page === 'admin' ? 'page' : undefined} onClick={() => setPage('admin')}><Shield size={16} />Admin</button></>}
        <div className="mt-auto px-3 pt-4 text-xs" style={{ color: 'var(--mute)' }}>{e.planName || 'No active plan'}{rem ? ` · ${rem[1]} left` : ''}<br />v{info ? info.version : ''}</div>
      </nav>
      <main className="flex-1 overflow-auto p-6">
        {session.updateRequired && <p role="alert" className="panel p-2 mb-4 text-sm">Update required{typeof session.updateRequired === 'string' ? ` (version ${session.updateRequired} or newer)` : ''}. Online features are paused; local tools still work. <Btn className="ml-2" onClick={() => setPage('settings')}>Check for updates</Btn></p>}
        {session.offline && <p role="status" className="panel p-2 mb-4 text-sm flex gap-2 items-center"><WifiOff size={14} />You are offline. Local tools still work; account and payments need internet.</p>}
        {e.source === 'NONE' && !['pricing', 'account', 'help', 'contact', 'bug', 'settings', 'queue'].includes(page) && <Card className="mb-4"><strong>{e.trialExpired ? 'Your free trial has ended.' : 'No active plan.'}</strong> Choose a plan to keep using the tools. <Btn primary className="ml-3" onClick={() => setPage('pricing')}>See plans</Btn></Card>}
        {page === 'home' && <Home session={session} goto={setPage} />}
        {['video', 'audio', 'images', 'pdf'].includes(page) && <ToolPage id={page} />}
        {page === 'queue' && <div><h1 className="text-xl font-semibold">Queue</h1><JobList /></div>}
        {page === 'vault' && <Vault allowed={!!e.features.mediaVault} goto={setPage} />}
        {page === 'pricing' && <Pricing session={session} goto={setPage} onChanged={refresh} />}
        {page === 'help' && <Help goto={setPage} />}
        {page === 'contact' && <Contact session={session} />}
        {page === 'bug' && <BugReport info={info} />}
        {page === 'settings' && <Settings onTheme={applyTheme} />}
        {page === 'account' && <Account session={session} onLogout={onLogout} goto={setPage} onChanged={refresh} />}
        {page === 'admin' && isAdmin && <Admin me={session.user} />}
      </main>
      {reauth && <ReauthModal onDone={() => closeReauth(true)} onCancel={() => closeReauth(false)} />}
    </div>
  );
}

function ReauthModal({ onDone, onCancel }) {
  const [code, setCode] = useState(''); const a = useAction(); const sent = useAction();
  useEffect(() => { sent.run(() => call('POST', '/api/admin/reauth/request'), 'We emailed you a 6-digit code.'); }, []); // eslint-disable-line
  return (<div role="dialog" aria-modal="true" aria-label="Confirm it is you" className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,.5)' }}><Card title="Confirm it is you" className="w-96"><p className="text-sm mb-3" style={{ color: 'var(--mute)' }}>This action needs a quick check. Enter the code we emailed you.</p><form onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => call('POST', '/api/admin/reauth/confirm', { code }))) onDone(); }} className="grid gap-3"><Field label="6-digit code"><input inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></Field><Msg kind="ok">{sent.ok}</Msg><Msg>{a.err || sent.err}</Msg><div className="flex gap-2"><Btn primary type="submit" disabled={a.busy || code.length !== 6}>Confirm</Btn><Btn type="button" onClick={() => sent.run(() => call('POST', '/api/admin/reauth/request'), 'A new code was sent.')}>Resend code</Btn><Btn type="button" onClick={onCancel}>Cancel</Btn></div></form></Card></div>);
}

function Home({ session, goto }) {
  const e = session.entitlement;
  return (<div><h1 className="text-xl font-semibold mb-1">Welcome{session.user.name ? `, ${session.user.name}` : ''}</h1>
    <p className="mb-4" style={{ color: 'var(--mute)' }}>{e.source === 'NONE' ? 'Choose a plan to start.' : e.lifetime ? `${e.planName} (lifetime)` : `${e.planName}${e.endsAt ? ` until ${date(e.endsAt)}` : ''}`}{Object.keys(session.remaining || {}).length > 0 ? ` · ${Object.entries(session.remaining).map(([k, v]) => `${v} left ${{ today: 'today', month: 'this month', total: 'in your trial' }[k]}`).join(', ')}` : ''}</p>
    <div className="grid gap-4 md:grid-cols-2">{TOOLS.map(([id, t, d, Icon]) => <button key={id} className="panel p-4 text-left" onClick={() => goto(id)}><Icon size={20} style={{ color: 'var(--accent)' }} /><div className="font-semibold mt-2">{t}</div><div style={{ color: 'var(--mute)' }}>{d}</div></button>)}</div></div>);
}
