// Loaded INTO the real Electron main process via NODE_OPTIONS=--require (test only; production code is untouched).
const electron = require('electron'); if (typeof electron === 'string') return; // the Node launcher that spawns Electron also loads this file; only the real main process continues
const { app } = electron; const fs = require('fs'); const path = require('path');
console.log('SMOKE_DEBUG hook loaded in main process');
const results = []; const rec = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
const DIR = process.env.MTP_SMOKE_DIR; let started = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => { console.log('SMOKE_DEBUG window created'); win.webContents.on('did-fail-load', (_ev, code, desc, url) => console.log(`SMOKE_DEBUG load failed ${code} ${desc} ${url}`)); win.webContents.on('console-message', (_ev, level, msg) => { if (level >= 2) console.log(`SMOKE_DEBUG renderer: ${msg.slice(0, 300)}`); }); win.webContents.on('did-finish-load', async () => { console.log('SMOKE_DEBUG did-finish-load');
  if (started) return; started = true;
  try { await run(win); } catch (e) { rec('harness crashed', false, e.stack); }
  console.log(`SMOKE_RESULT:${JSON.stringify(results)}`); setTimeout(() => app.exit(0), 300);
}); });
async function run(win) {
  const ev = (code) => win.webContents.executeJavaScript(code, true);
  const sec = await ev(`({ req: typeof window.require, proc: typeof process, el: typeof window.electron, ipc: typeof window.mediaAPI.ipcRenderer, frozen: Object.isFrozen(window.mediaAPI), keys: Object.keys(window.mediaAPI) })`);
  rec('renderer has no Node access and a frozen, narrow bridge', sec.req === 'undefined' && sec.proc === 'undefined' && sec.el === 'undefined' && sec.ipc === 'undefined' && sec.frozen && sec.keys.includes('enqueue') && !sec.keys.includes('send'), JSON.stringify(sec));
  let home = false; for (let i = 0; i < 80 && !home; i++) { home = await ev(`document.body.innerText.includes('Welcome') && document.body.innerText.includes('Smoke')`); if (!home) await sleep(250); }
  rec('real UI boots, signs in through main-process API client and shows Home', home, await ev('document.body.innerText.slice(0,300)'));
  fs.writeFileSync(path.join(DIR, 'home.png'), (await win.webContents.capturePage()).toPNG());
  const rej = (code) => ev(`(async()=>{ try { await ${code}; return 'allowed'; } catch(e){ return 'rejected'; } })()`);
  rec('bridge rejects off-list API paths, gateway callbacks and unknown files', (await Promise.all([rej(`window.mediaAPI.api('GET','http://evil.example/x')`), rej(`window.mediaAPI.api('POST','/api/payments/sslcommerz/ipn',{})`), rej(`window.mediaAPI.openPath('/etc/passwd')`), rej(`window.mediaAPI.enqueue({type:'rm',input:'/x'})`), rej(`window.mediaAPI.openCheckout('https://evil.example/pay')`)])).every((x) => x === 'rejected'));
  await ev(`window.location.href='https://example.com/'`); await sleep(800);
  rec('navigation away from the app is blocked', (await ev('location.origin')).startsWith('http://localhost'), await ev('location.href'));
  const hw = await ev(`window.mediaAPI.detectHardware()`); rec('hardware detection answers and falls back to CPU here', typeof hw.vaapi === 'boolean' && hw.vaapi === false && !!hw.reason, JSON.stringify(hw));
  const run1 = (type, input, options) => ev(`(async()=>{ const id = await window.mediaAPI.enqueue({type:${JSON.stringify(type)}, input:${JSON.stringify(input)}, options:${JSON.stringify(options)}}); for (let i=0;i<240;i++){ const j=(await window.mediaAPI.listJobs()).find(x=>x.id===id); if(['COMPLETED','FAILED','CANCELLED'].includes(j.status)) return j; await new Promise(r=>setTimeout(r,250)); } return {status:'TIMEOUT'}; })()`);
  const P = (f) => path.join(DIR, f);
  const jobs = { 'video H.264 CPU': await run1('video', P('vid.mp4'), { mode: 'cpu', rotate: 90 }), 'video remux': await run1('video', P('vid.mp4'), { mode: 'remux' }), 'video GPU request falls back to CPU': await run1('video', P('vid.mp4'), { mode: 'hardware' }),
    'audio mp3 extract': await run1('audio', P('vid.mp4'), { format: 'mp3', bitrate: 0 }), 'image to jpg': await run1('heic', P('p1.png'), { quality: 90 }), 'images to pdf': await run1('imagesToPdf', [P('p1.png'), P('p2.png')], { filename: 'combined_photos' }) };
  for (const [n, j] of Object.entries(jobs)) rec(`job: ${n}`, j.status === 'COMPLETED' && fs.existsSync(j.output) && fs.statSync(j.output).size > 0, JSON.stringify({ status: j.status, error: j.error }));
  const m = await run1('mergePdf', [jobs['images to pdf'].output, jobs['images to pdf'].output], { filename: 'merged_document' }); rec('job: merge PDFs', m.status === 'COMPLETED' && fs.statSync(m.output).size > 0, JSON.stringify(m));
  const dup = await run1('video', P('vid.mp4'), { mode: 'remux' }); rec('existing outputs are never overwritten (numbered copy)', /\(\d+\)\.mp4$/.test(dup.output || ''), dup.output);
  const bad = await run1('video', P('not-a-video.mp4'), { mode: 'cpu' }); rec('corrupt input fails with a friendly error, app survives', bad.status === 'FAILED' && !!bad.error && !/at .*\.js:\d+/.test(bad.error), JSON.stringify(bad));
  const longOut = P('long_compressed.mp4'); const cancelled = await ev(`(async()=>{ const id = await window.mediaAPI.enqueue({type:'video', input:${JSON.stringify(P('long.mp4'))}, options:{mode:'max', preset:'slow'}}); await new Promise(r=>setTimeout(r,2500)); await window.mediaAPI.cancelJob(id); for (let i=0;i<80;i++){ const j=(await window.mediaAPI.listJobs()).find(x=>x.id===id); if(['COMPLETED','FAILED','CANCELLED'].includes(j.status)) return j; await new Promise(r=>setTimeout(r,250)); } return {status:'TIMEOUT'}; })()`);
  await sleep(500); rec('cancelling a running encode stops it and leaves no partial file', cancelled.status === 'CANCELLED' && !fs.existsSync(longOut), JSON.stringify({ s: cancelled.status, partial: fs.existsSync(longOut) }));
  const hist = await ev(`window.mediaAPI.getHistory({})`); rec('Media Vault recorded successes and the failure', hist.filter((h) => h.success).length >= 8 && hist.some((h) => !h.success), `rows=${hist.length}`);
  const vrow = hist.find((h) => h.success && h.media_type === 'video'); const th = vrow && await ev(`window.mediaAPI.thumbnail(${JSON.stringify(vrow.id)})`); rec('vault video thumbnail is generated by FFmpeg', typeof th === 'string' && th.startsWith('data:image/jpeg;base64,'), String(th).slice(0, 40));
  const del = hist.find((h) => h.output_path); await ev(`window.mediaAPI.deleteHistory(${JSON.stringify(del.id)})`); rec('deleting a history record keeps the real file', fs.existsSync(del.output_path));
  const logs = path.join(app.getPath('userData'), 'logs'); rec('persistent logs exist and the failed job went to the right log', fs.existsSync(logs) && /job video failed/.test(fs.readFileSync(path.join(logs, 'ffmpeg.log'), 'utf8')), fs.existsSync(logs) ? fs.readdirSync(logs).join(',') : 'no logs dir');
}
