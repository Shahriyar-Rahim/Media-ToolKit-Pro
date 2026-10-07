const { ipcMain, dialog, shell, session, app } = require("electron");
const fs = require("fs");
const path = require("path");
const { JobQueue } = require("../services/jobQueue");
const { makeRunners } = require("../services/runners");
const ff = require("../services/ffmpeg");
const {
  validateEnqueue,
  isAbs,
  isStr,
  fail,
  oneOf,
  int,
} = require("./validate");
const { createApiClient } = require("../services/apiClient");
const { createLicence } = require("../services/licence");
const { createLogger } = require("../services/logger");
const { createThumbs } = require("../services/thumbs");
const { createUpdater } = require("../services/updater");
const { prepareScreenshot } = require("../services/media-prep");
const imageHost = require("../services/imageHost");

const DEFAULTS = {
  outputMode: "source",
  outputDir: null,
  concurrency: 2,
  theme: "system",
};
const FILTERS = {
  video: [
    {
      name: "Video",
      extensions: ["mp4", "mov", "mkv", "avi", "ts", "tmp", "webm", "m4v"],
    },
  ],
  audio: [
    {
      name: "Audio/Video",
      extensions: [
        "mp3",
        "wav",
        "flac",
        "aac",
        "m4a",
        "ogg",
        "mp4",
        "mov",
        "mkv",
        "avi",
        "ts",
      ],
    },
  ],
  heic: [{ name: "HEIC", extensions: ["heic", "HEIC", "heif"] }],
  images: [
    {
      name: "Images",
      extensions: ["jpg", "jpeg", "png", "webp", "heic", "tiff"],
    },
  ],
  pdf: [{ name: "PDF", extensions: ["pdf"] }],
};

function registerIpc({ db, getWindow, userData }) {
  const log = createLogger({
    dir: path.join(userData || app.getPath("userData"), "logs"),
  });
  imageHost.setLogger(log);
  const thumbOf = createThumbs({ ffmpegPath: ff.ffmpegPath });
  const updater = createUpdater({ app, log });
  process.on("uncaughtException", (e) =>
    log.app("error", "uncaught exception", { e: e && e.stack }),
  );
  process.on("unhandledRejection", (e) =>
    log.app("error", "unhandled rejection", { e: e && (e.stack || e.message) }),
  );
  // ---- who is signed in right now (several accounts can share one computer; nothing local is shared between them) ----
  let licence; // created below
  const currentUserId = () => {
    const s = licence && licence.state();
    return s && s.signedIn && s.user ? String(s.user.id) : null;
  };
  const settingsKey = (uid) => (uid ? `app:${uid}` : "app");
  const getSettings = (uid = currentUserId()) => ({
    ...DEFAULTS,
    ...db.getSetting("app", {}),
    ...(uid ? db.getSetting(settingsKey(uid), {}) : {}),
  }); // per-account output folder, theme...
  const mine = (j) =>
    !!(j.meta && j.meta.userId) && j.meta.userId === currentUserId();
  const queue = new JobQueue({
    concurrency: getSettings().concurrency,
    runners: makeRunners({ db, getSettings }),
    onUpdate: (job) => {
      const w = getWindow();
      if (w && !w.isDestroyed() && mine(job))
        w.webContents.send("jobs:update", job);
    }, // only the owner's window ever hears about a job
  });

  const apiSession = session.fromPartition("persist:mtp-api"); // cookies stay here, invisible to the renderer
  const LIVE_SERVER_URL = "https://media-toolkit-pro.onrender.com";
  const API_URL = (
    process.env.MTP_API_URL ||
    (app.isPackaged ? LIVE_SERVER_URL : "http://localhost:4000")
  ).replace(/\/$/, "");
  const api = createApiClient({
    fetchImpl: (u, o) => apiSession.fetch(u, o),
    getBase: () => API_URL,
    version: app.getVersion(),
  });
  let publicKey = process.env.MTP_ENTITLEMENT_PUBLIC_KEY || null;
  try {
    publicKey =
      publicKey ||
      fs.readFileSync(
        path.join(__dirname, "..", "config", "entitlement-public.pem"),
        "utf8",
      );
  } catch {
    /* offline mode stays disabled */
  }
  licence = createLicence({ db, api, publicKey });

  // Reject any IPC call not coming from our own main window's top frame.
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, payload) => {
      const w = getWindow();
      if (
        !w ||
        event.sender !== w.webContents ||
        event.senderFrame !== w.webContents.mainFrame
      ) {
        log.security("warn", "rejected IPC from untrusted sender", { channel });
        throw new Error("Untrusted sender");
      }
      return fn(payload, event);
    });

  handle("dialog:selectFiles", async (p) => {
    const kind = p && p.kind;
    oneOf(kind, Object.keys(FILTERS), "kind");
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: ["openFile", "multiSelections"],
      filters: FILTERS[kind],
    });
    if (r.canceled) return [];
    return [...new Set(r.filePaths)].map((f) => ({
      path: f,
      name: path.basename(f),
      size: fs.statSync(f).size,
    }));
  });
  handle("settings:chooseOutputDir", async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled) return getSettings();
    db.setSetting(settingsKey(currentUserId()), {
      ...getSettings(),
      outputMode: "custom",
      outputDir: r.filePaths[0],
    });
    return getSettings();
  });
  handle("settings:get", async () => getSettings());
  handle("settings:set", async (p) => {
    const next = { ...getSettings() };
    if (p.outputMode != null)
      next.outputMode =
        oneOf(p.outputMode, ["source", "custom"], "outputMode") && p.outputMode;
    if (p.concurrency != null) {
      int(p.concurrency, 1, 8, "concurrency");
      next.concurrency = p.concurrency;
      queue.setConcurrency(p.concurrency);
    }
    if (p.theme != null)
      next.theme =
        oneOf(p.theme, ["light", "dark", "system"], "theme") && p.theme;
    db.setSetting(settingsKey(currentUserId()), next);
    return next;
  });
  handle("media:detectHardware", () => ff.detectHardware());
  handle("jobs:enqueue", async (p) => {
    const v = validateEnqueue(p);
    const files = Array.isArray(v.input) ? v.input : [v.input];
    let size = 0;
    for (const f of files) {
      try {
        size += fs.statSync(f).size;
      } catch {
        throw new Error(
          `Source file is missing or unreadable: ${path.basename(f)}`,
        );
      }
    }
    await licence.gate({
      type: v.type,
      options: v.options,
      fileSize: size,
      fileCount: v.batchSize,
    }); // plan + usage check happens BEFORE any work starts
    return queue.enqueue(v.type, v.input, v.options, {
      userId: currentUserId(),
    });
  });
  handle("api:request", (p) => {
    if (!p || typeof p !== "object") fail("payload");
    return api.request(p.method, p.path, p.body);
  });
  handle("auth:boot", () => licence.boot());
  handle("auth:state", () => licence.state());
  handle("auth:refresh", () => licence.refresh());
  handle("auth:logout", () => licence.logout());
  handle("shell:openCheckout", (url) => {
    // only the payment gateway's own https pages may be opened
    let u;
    try {
      u = new URL(url);
    } catch {
      fail("url");
    }
    if (u.protocol !== "https:" || !/(^|\.)sslcommerz\.com$/.test(u.hostname))
      fail("checkout url");
    return shell.openExternal(u.toString()).then(() => true);
  });
  handle("bug:prepareScreenshot", async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
      ],
    });
    if (r.canceled) return null;
    try {
      return {
        name: path.basename(r.filePaths[0]),
        ...(await prepareScreenshot(r.filePaths[0])),
      };
    } catch (e) {
      log.app("warn", "screenshot prep failed", { e });
      throw new Error(
        e.message.startsWith("That") || e.message.startsWith("Could not")
          ? e.message
          : "That file could not be read as an image.",
      );
    }
  });
  handle("log:recent", () => ({ text: log.recent() }));
  handle("vault:thumbnail", async (id) => {
    isStr(id, 64) || fail("id");
    return thumbOf(db.getHistoryRow(id, currentUserId()));
  });
  handle("update:check", () => updater.check());
  handle("update:download", () => updater.download());
  handle("update:install", () => updater.install());
  handle("app:info", () => ({
    version: app.getVersion(),
    apiUrl: API_URL,
    offlineCapable: !!publicKey,
  }));
  const owned = (id) => {
    const j = queue.list().find((x) => x.id === id);
    return !!j && mine(j);
  };
  handle("jobs:cancel", (id) => {
    isStr(id, 64) || fail("id");
    return owned(id) ? queue.cancel(id) : false;
  });
  handle("jobs:retry", (id) => {
    isStr(id, 64) || fail("id");
    return owned(id) ? queue.retry(id) : null;
  });
  handle("jobs:list", () => queue.list().filter(mine));
  handle("history:list", (p = {}) => {
    const userId = currentUserId();
    db.claimLegacy(userId);
    return db.listHistory({
      userId,
      search: isStr(p.search, 200) ? p.search : "",
      mediaType: ["video", "audio", "image", "pdf"].includes(p.mediaType)
        ? p.mediaType
        : "",
      sort: ["new", "old", "size"].includes(p.sort) ? p.sort : "new",
      limit: 100,
      offset: Number.isInteger(p.offset) ? p.offset : 0,
    });
  });
  handle("history:delete", (id) => {
    isStr(id, 64) || fail("id");
    db.deleteHistory(id, currentUserId());
    return true;
  });
  handle("history:clear", () => {
    db.clearHistory(currentUserId());
    return true;
  });
  // Only paths that exist in history may be opened, so the renderer can't open arbitrary files.
  const known = (p) =>
    isAbs(p) &&
    db
      .listHistory({ userId: currentUserId(), limit: 100000 })
      .some((h) => h.output_path === p);
  // log every failed job in the right place (FFmpeg vs app), never shown raw to users
  queue.onUpdate = ((prev) => (job) => {
    if (job.status === "FAILED")
      log[["video", "audio"].includes(job.type) ? "ffmpeg" : "app"](
        "error",
        `job ${job.type} failed`,
        { error: job.error },
      );
    prev(job);
  })(queue.onUpdate);
  handle("shell:openPath", async (p) => {
    known(p) || fail("unknown file");
    return shell.openPath(p);
  });
  handle("shell:showInFolder", (p) => {
    known(p) || fail("unknown file");
    shell.showItemInFolder(p);
    return true;
  });
}
module.exports = { registerIpc };
