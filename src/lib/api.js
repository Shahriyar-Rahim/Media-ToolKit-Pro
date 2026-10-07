// Every call goes through the main process (cookies never reach the renderer).
let reauthHandler = null;
export const setReauthHandler = (h) => { reauthHandler = h; };
async function once(method, path, body) {
  let r;
  try { r = await window.mediaAPI.api(method, path, body); }
  catch (e) { throw new Error(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  if (r.status >= 200 && r.status < 300) return r.data;
  const e = new Error((r.data && r.data.error) || 'Request failed'); e.status = r.status; e.code = r.data && r.data.code; e.network = !!r.networkError;
  if (e.network && method !== 'GET') e.message = 'The server did not answer in time. Your action may still have gone through. The list has been refreshed: please check it before trying again.';
  throw e;
}
// Sensitive admin actions answer REAUTH_REQUIRED until an emailed code is confirmed; the UI asks once, then the action is retried.
export async function call(method, path, body) {
  try { return await once(method, path, body); }
  catch (e) { if (e.code === 'REAUTH_REQUIRED' && reauthHandler) { await reauthHandler(); return once(method, path, body); } throw e; }
}
export const money = (minor, cur = 'BDT') => `${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
export const date = (d) => (d ? new Date(d).toLocaleDateString() : '—');
export const FEATURE_LABELS = { videoCompression: 'Video compression', hardwareAcceleration: 'Hardware acceleration', maximumCompression: 'Maximum compression (H.265)', audioConversion: 'Audio tools', heicConversion: 'Image conversion (HEIC to JPG)', pdfCreate: 'Images to PDF', pdfMerge: 'Merge PDFs', batchProcessing: 'Batch processing', mediaVault: 'Media Vault', priorityProcessing: 'Priority processing', advancedSettings: 'Advanced settings' };
