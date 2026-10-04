const test = require('node:test');
const assert = require('node:assert');
const { JobQueue } = require('../services/jobQueue');
const { validateEnqueue } = require('../ipc/validate');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('respects concurrency limit and completes all jobs', async () => {
  let running = 0, peak = 0;
  const q = new JobQueue({ concurrency: 2, runners: { t: async () => { running++; peak = Math.max(peak, running); await sleep(30); running--; return 'ok'; } } });
  const ids = [1, 2, 3, 4, 5].map(() => q.enqueue('t', 'x'));
  await sleep(300);
  assert.strictEqual(peak, 2);
  assert.ok(ids.every((id) => q.list().find((j) => j.id === id).status === 'COMPLETED'));
});
test('cancels queued job and retries a failed one; one failure does not stop others', async () => {
  let n = 0;
  const q = new JobQueue({ concurrency: 1, runners: { t: async () => { await sleep(20); if (n++ === 0) throw new Error('boom'); return 'ok'; } } });
  const a = q.enqueue('t', 'a'), b = q.enqueue('t', 'b'), c = q.enqueue('t', 'c');
  assert.ok(q.cancel(c));
  await sleep(120);
  const s = (id) => q.list().find((j) => j.id === id).status;
  assert.deepStrictEqual([s(a), s(b), s(c)], ['FAILED', 'COMPLETED', 'CANCELLED']);
  const r = q.retry(a); await sleep(60);
  assert.strictEqual(s(r), 'COMPLETED');
});
test('active job cancellation kills process', async () => {
  const q = new JobQueue({ concurrency: 1, runners: { t: (j, { ctl }) => new Promise((_, rej) => { ctl.kill = () => rej(new Error('killed')); }) } });
  const id = q.enqueue('t', 'x'); await sleep(10);
  q.cancel(id); await sleep(10);
  assert.strictEqual(q.list()[0].status, 'CANCELLED');
});
test('IPC validation rejects bad input and relative paths', () => {
  assert.throws(() => validateEnqueue({ type: 'rm', input: '/a' }));
  assert.throws(() => validateEnqueue({ type: 'video', input: '../etc/passwd' }));
  assert.throws(() => validateEnqueue({ type: 'video', input: '/a.mp4', options: { mode: 'x' } }));
  assert.throws(() => validateEnqueue({ type: 'video', input: '/a.mp4', options: { crf: 99 } }));
  const ok = validateEnqueue({ type: 'audio', input: '/a.mp4', options: { format: 'mp3', bitrate: 128 } });
  assert.strictEqual(ok.options.format, 'mp3');
});
