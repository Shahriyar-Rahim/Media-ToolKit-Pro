// Uses the official electron-updater mechanism only (signed releases from your own HTTPS feed). Nothing downloads or installs
// without the user pressing a button, and development builds report "not supported".
function createUpdater({ app, log, load = () => require('electron-updater').autoUpdater }) {
  let au = null, found = null;
  const supported = () => app.isPackaged && !process.env.MTP_DISABLE_UPDATES;
  function init() {
    if (au) return au; au = load(); au.autoDownload = false; au.autoInstallOnAppQuit = false; au.allowPrerelease = false;
    au.on('error', (e) => log.app('warn', 'updater error', { e }));
    return au;
  }
  return {
    async check() {
      if (!supported()) return { supported: false, message: 'Updates are only available in installed builds.' };
      try { const r = await init().checkForUpdates(); const v = r && r.updateInfo && r.updateInfo.version; found = v && v !== app.getVersion() ? v : null; return { supported: true, available: !!found, version: found, current: app.getVersion() }; }
      catch (e) { log.app('warn', 'update check failed', { e }); return { supported: true, error: 'Could not check for updates. Try again later.' }; }
    },
    async download() { if (!supported() || !found) return { ok: false }; try { await init().downloadUpdate(); return { ok: true }; } catch (e) { log.app('warn', 'update download failed', { e }); return { ok: false, error: 'Download failed. Try again later.' }; } },
    install() { if (!supported() || !found) return false; init().quitAndInstall(false, true); return true; },
  };
}
module.exports = { createUpdater };
