const { randomUUID } = require('crypto');
const S = { QUEUED: 'QUEUED', PROCESSING: 'PROCESSING', COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' };

class JobQueue {
  constructor({ concurrency = 2, runners, onUpdate }) {
    this.concurrency = concurrency; this.runners = runners; this.onUpdate = onUpdate;
    this.jobs = new Map(); this.active = 0;
  }
  setConcurrency(n) { this.concurrency = Math.min(8, Math.max(1, n | 0)); this._pump(); }
  enqueue(type, input, options = {}, meta = {}) {
    if (!this.runners[type]) throw new Error(`Unknown job type: ${type}`);
    const job = { id: randomUUID(), type, input, options, meta /* meta.userId = the account that owns this job */, status: S.QUEUED, progress: { percent: null },
      startedAt: null, completedAt: null, output: null, error: null, _ctl: { cancelled: false, kill: null } };
    this.jobs.set(job.id, job); this._emit(job); this._pump(); return job.id;
  }
  cancel(id) {
    const j = this.jobs.get(id); if (!j) return false;
    if (j.status === S.QUEUED) { this._finish(j, S.CANCELLED); return true; }
    if (j.status === S.PROCESSING) { j._ctl.cancelled = true; j._ctl.kill && j._ctl.kill(); return true; }
    return false;
  }
  retry(id) {
    const j = this.jobs.get(id);
    if (!j || ![S.FAILED, S.CANCELLED].includes(j.status)) return null;
    return this.enqueue(j.type, j.input, j.options, j.meta);
  }
  list() { return [...this.jobs.values()].map(this._view); }
  _view(j) { const { _ctl, ...v } = j; return v; }
  _emit(j) { this.onUpdate && this.onUpdate(this._view(j)); }
  _finish(j, status, extra = {}) { Object.assign(j, { status, completedAt: Date.now() }, extra); this._emit(j); }
  _pump() {
    for (const j of this.jobs.values()) {
      if (this.active >= this.concurrency) break;
      if (j.status !== S.QUEUED) continue;
      this.active++; j.status = S.PROCESSING; j.startedAt = Date.now(); this._emit(j);
      this.runners[j.type](j, {
        ctl: j._ctl,
        progress: (p) => { j.progress = p; this._emit(j); },
      }).then((output) => this._finish(j, j._ctl.cancelled ? S.CANCELLED : S.COMPLETED, { output }))
        .catch((e) => this._finish(j, j._ctl.cancelled ? S.CANCELLED : S.FAILED, { error: e.message }))
        .finally(() => { this.active--; this._pump(); });
    }
  }
}
module.exports = { JobQueue, JOB_STATUS: S };
