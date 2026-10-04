// Launches the PACKAGED app (release/linux-unpacked) under Xvfb and checks it over the Chrome DevTools Protocol.
// Proves the production Content-Security-Policy, asar unpacking of FFmpeg/Sharp/SQLite, and the version string. Run: npm run pack && node scripts/smoke-packaged.js
const http = require('http'); const { spawn, execFileSync } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const root = path.join(__dirname, '..'); const bin = path.join(root, 'release/linux-unpacked/media-toolkit-pro'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtp-pk-'));
if (!fs.existsSync(bin)) { console.log('Packaged app not found. Run: npm run pack'); process.exit(2); }
execFileSync(require('ffmpeg-static'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'vid.mp4')]);
const ent = { source: 'SUBSCRIPTION', planName: 'Pack plan', lifetime: true, features: Object.fromEntries(['videoCompression', 'audioConversion', 'mediaVault'].map((f) => [f, true])), limits: {}, remaining: {} };
const api = http.createServer((req, res) => { const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/api/auth/me') return send({ user: { id: 'u1', email: 'p@test.dev', name: 'Pack', role: 'CUSTOMER', emailVerified: true } }); if (req.url === '/api/usage/entitlement') return send({ entitlement: ent, snapshot: null }); if (req.url === '/api/usage/consume') return send({ ok: true, entitlement: ent }); send({ error: 'nf' }, 404); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res(b)); }).on('error', rej));
api.listen(0, async () => {
  const p = spawn('xvfb-run', ['-a', bin, '--no-sandbox', '--remote-debugging-port=9333', `--user-data-dir=${path.join(dir, 'ud')}`], { env: { ...process.env, MTP_API_URL: `http://127.0.0.1:${api.address().port}` } }); const results = []; const rec = (n, ok, d) => results.push({ n, ok: !!ok, d });
  try {
    let target; for (let i = 0; i < 80 && !target; i++) { await sleep(500); try { target = JSON.parse(await get('http://127.0.0.1:9333/json')).find((t) => t.type === 'page'); } catch { /* not up yet */ } }
    if (!target) throw new Error('packaged app did not open a window');
    const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; }); let id = 0; const wait = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
    const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: false }); /* default would let DevTools bypass the page's eval restriction */ if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception)); return r.result.result.value; };
    let home = false; for (let i = 0; i < 60 && !home; i++) { home = await ev(`!!document.body && document.body.innerText.includes('Welcome') && document.body.innerText.includes('Pack')`).catch(() => false); if (!home) await sleep(500); }
    rec('packaged UI boots and signs in (file:// origin, real IPC)', home && (await ev('location.protocol')) === 'file:', await ev('document.body.innerText.slice(0,120)'));
    const csp = await ev(`(()=>{ let evalBlocked=false; try { new Function('return 1')(); } catch { evalBlocked=true; } window.__x=0; const sc=document.createElement('script'); sc.textContent='window.__x=1'; document.head.appendChild(sc); const m=document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]'); return { evalBlocked, inlineBlocked: window.__x===0, meta: m ? m.content : null }; })()`);
    rec('production CSP blocks eval and injected inline scripts', csp.evalBlocked && csp.inlineBlocked, JSON.stringify(csp));
    rec('renderer has no Node access', (await ev(`typeof window.require==='undefined' && typeof process==='undefined' && Object.isFrozen(window.mediaAPI)`)) === true);
    const info = await ev(`window.mediaAPI.appInfo()`); rec('app reports its real version from package.json', info.version === require('../package.json').version, JSON.stringify(info));
    const job = await ev(`(async()=>{ const id = await window.mediaAPI.enqueue({type:'video', input:${JSON.stringify(path.join(dir, 'vid.mp4'))}, options:{mode:'cpu'}}); for (let i=0;i<120;i++){ const j=(await window.mediaAPI.listJobs()).find(x=>x.id===id); if(['COMPLETED','FAILED','CANCELLED'].includes(j.status)) return j; await new Promise(r=>setTimeout(r,250)); } return {status:'TIMEOUT'}; })()`);
    rec('FFmpeg (unpacked from asar) encodes a video in the packaged app', job.status === 'COMPLETED' && fs.existsSync(job.output) && fs.statSync(job.output).size > 0, JSON.stringify(job));
    const hist = await ev(`window.mediaAPI.getHistory({})`); rec('SQLite (rebuilt for Electron) stored the history', hist.length >= 1 && hist[0].success === 1, `rows=${hist.length}`);
    const th = await ev(`window.mediaAPI.thumbnail(${JSON.stringify(hist[0] && hist[0].id)})`); rec('thumbnail generation works when packaged', typeof th === 'string' && th.startsWith('data:image/jpeg'), String(th).slice(0, 30));
    const shot = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(dir, 'packaged.png'), Buffer.from(shot.result.data, 'base64')); ws.close();
  } catch (e) { rec('harness', false, e.message); }
  p.kill('SIGKILL'); api.close(); for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : `\n      ${r.d}`}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed. Screenshot: ${path.join(dir, 'packaged.png')}`); process.exit(results.every((r) => r.ok) ? 0 : 1);
});
