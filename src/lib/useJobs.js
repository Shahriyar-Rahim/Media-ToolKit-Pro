import { useEffect, useState, useCallback } from 'react';
export function useJobs() {
  const [jobs, setJobs] = useState({});
  useEffect(() => {
    window.mediaAPI.listJobs().then((l) => setJobs(Object.fromEntries(l.map((j) => [j.id, j]))));
    return window.mediaAPI.onJobUpdate((j) => setJobs((p) => ({ ...p, [j.id]: j })));
  }, []);
  const list = Object.values(jobs).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const counts = { done: list.filter((j) => j.status === 'COMPLETED').length, failed: list.filter((j) => j.status === 'FAILED').length,
    remaining: list.filter((j) => ['QUEUED', 'PROCESSING'].includes(j.status)).length, total: list.length };
  return { list, counts };
}
export const fmtBytes = (n) => n == null ? '—' : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;
export const fmtTime = (s) => s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
