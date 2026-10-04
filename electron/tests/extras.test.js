const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const sharp = require("sharp");
const ff = require("../services/ffmpeg");
const { createLogger } = require("../services/logger");
const { prepareScreenshot } = require("../services/media-prep");
const { createThumbs } = require("../services/thumbs");
const { createUpdater } = require("../services/updater");
const { createLicence } = require("../services/licence");
const { checkScreenshot } = require("../../server/src/utils/identity");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtp-x-"));
const FF = ff.ffmpegPath;
const haveFF = FF && fs.existsSync(FF);

test("LOGGER writes separate channels, scrubs the home directory and secrets, rotates by size", () => {
  const dir = path.join(tmp, "logs");
  const log = createLogger({ dir, home: "/home/sam", maxBytes: 300 });
  log.app("error", "failed reading /home/sam/Videos/a.mp4 token=abc123", {
    e: new Error("boom at /home/sam/x"),
  });
  log.security("warn", "bad sender");
  log.ffmpeg("error", "ffmpeg exited 1");
  const app = fs.readFileSync(path.join(dir, "app.log"), "utf8");
  assert.match(app, /~\/Videos\/a\.mp4/);
  assert.ok(!app.includes("/home/sam") && !app.includes("abc123"));
  assert.match(app, /token=\[redacted\]/);
  for (const c of ["security", "ffmpeg"])
    assert.ok(fs.existsSync(path.join(dir, `${c}.log`)));
  for (let i = 0; i < 20; i++) log.app("info", "x".repeat(60));
  assert.ok(fs.existsSync(path.join(dir, "app.log.1")), "rotated");
  assert.match(log.recent(5), /# app\.log[\s\S]*# ffmpeg\.log/);
  assert.doesNotThrow(() =>
    createLogger({ dir, home: "/h" }).app("info", "ok"),
  ); // never throws
});
test("SCREENSHOT prep shrinks a large image and the result passes the server validator", async () => {
  const big = path.join(tmp, "big.png");
  await sharp({
    create: {
      width: 3000,
      height: 2000,
      channels: 3,
      background: { r: 10, g: 120, b: 200 },
    },
  })
    .png()
    .toFile(big);
  const r = await prepareScreenshot(big);
  assert.ok(r.bytes <= 550000);
  assert.strictEqual(checkScreenshot(r.dataUrl), null);
  await assert.rejects(prepareScreenshot(path.join(tmp, "nope.png")));
  fs.writeFileSync(path.join(tmp, "x.png"), "not an image");
  await assert.rejects(prepareScreenshot(path.join(tmp, "x.png")));
});
test(
  "THUMBNAILS: image and video produce JPEG data URLs; audio, missing files and failures fall back to null",
  { skip: !haveFF },
  async () => {
    const img = path.join(tmp, "t.png");
    await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#335577" },
    })
      .png()
      .toFile(img);
    const vid = path.join(tmp, "t.mp4");
    execFileSync(
      FF,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=320x240:rate=25:duration=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        vid,
      ],
      { stdio: "ignore" },
    );
    const thumb = createThumbs({ ffmpegPath: FF });
    assert.match(
      await thumb({
        id: "i",
        output_path: img,
        media_type: "image",
        success: 1,
      }),
      /^data:image\/jpeg;base64,/,
    );
    assert.match(
      await thumb({
        id: "v",
        output_path: vid,
        media_type: "video",
        success: 1,
      }),
      /^data:image\/jpeg;base64,/,
    );
    assert.strictEqual(
      await thumb({
        id: "a",
        output_path: img,
        media_type: "audio",
        success: 1,
      }),
      null,
    );
    assert.strictEqual(
      await thumb({
        id: "m",
        output_path: path.join(tmp, "gone.mp4"),
        media_type: "video",
        success: 1,
      }),
      null,
    );
    assert.strictEqual(
      await thumb({ id: "f", output_path: null, success: 0 }),
      null,
    );
    assert.strictEqual(await thumb(undefined), null);
  },
);
test("HARDWARE encoders: per-OS argument sets exist, rotation is applied, VAAPI path is unchanged", () => {
  for (const n of ["h264_nvenc", "h264_amf", "h264_qsv", "h264_videotoolbox"])
    assert.ok(ff.hwEncoderArgs(n, 23).includes(n), n);
  assert.strictEqual(ff.hwEncoderArgs("nope"), undefined);
  const w = ff
    .videoArgs(
      "in.mp4",
      "o.mp4",
      { mode: "hardware", rotate: 90 },
      { vaapi: false, hwEncoder: "h264_amf" },
    )
    .join(" ");
  assert.match(w, /-vf transpose=1/);
  assert.match(w, /-c:v h264_amf -rc cqp -qp_i 23/);
  assert.match(w, /-pix_fmt yuv420p/);
  assert.match(
    ff
      .videoArgs(
        "in.mp4",
        "o.mp4",
        { mode: "hardware" },
        { vaapi: true, device: "/dev/dri/renderD128" },
      )
      .join(" "),
    /-vf format=nv12,hwupload -c:v h264_vaapi -qp 23/,
  );
  assert.match(
    ff
      .videoArgs(
        "in.mp4",
        "o.mp4",
        { mode: "hardware" },
        { vaapi: false, hwEncoder: null },
      )
      .join(" "),
    /libx264/,
  ); // no hardware: CPU
});
test("UPDATER: dev builds report unsupported; installed builds need the user to act; errors are friendly", async () => {
  const log = { app() {} };
  const dev = createUpdater({
    app: { isPackaged: false, getVersion: () => "1.0.0" },
    log,
  });
  assert.strictEqual((await dev.check()).supported, false);
  assert.strictEqual(await dev.install(), false);
  const events = {};
  const au = {
    on: (e, f) => {
      events[e] = f;
    },
    checkForUpdates: async () => ({ updateInfo: { version: "1.1.0" } }),
    downloadUpdate: async () => {},
    quitAndInstall: () => {
      au.installed = true;
    },
  };
  const up = createUpdater({
    app: { isPackaged: true, getVersion: () => "1.0.0" },
    log,
    load: () => au,
  });
  assert.strictEqual((await up.download()).ok, false); // nothing found yet: never downloads on its own
  const c = await up.check();
  assert.deepStrictEqual([c.available, c.version], [true, "1.1.0"]);
  assert.strictEqual(au.autoDownload, false);
  assert.strictEqual((await up.download()).ok, true);
  assert.strictEqual(up.install(), true);
  assert.ok(au.installed);
  const same = createUpdater({
    app: { isPackaged: true, getVersion: () => "1.1.0" },
    log,
    load: () => au,
  });
  assert.strictEqual((await same.check()).available, false);
  const broken = createUpdater({
    app: { isPackaged: true, getVersion: () => "1" },
    log,
    load: () => ({
      on() {},
      checkForUpdates: async () => {
        throw new Error("ENOTFOUND secret-host");
      },
    }),
  });
  const e = await broken.check();
  assert.ok(e.error && !e.error.includes("secret-host"));
});
test("LICENCE: outdated app (426) pauses online features but local tools keep working offline", async () => {
  const m = {};
  const db = {
    getSetting: (k, d) => (k in m ? JSON.parse(JSON.stringify(m[k])) : d),
    setSetting: (k, v) => {
      m[k] = JSON.parse(JSON.stringify(v));
    },
  };
  const { generateKeyPairSync, sign } = require("crypto");
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const T0 = 1_800_000_000_000;
  const h = Buffer.from(JSON.stringify({ alg: "ES256" })).toString("base64url"),
    p = Buffer.from(
      JSON.stringify({
        sub: "u1",
        exp: T0 / 1000 + 3600,
        ent: {
          source: "SUBSCRIPTION",
          features: { videoCompression: true },
          limits: {},
        },
        remaining: {},
      }),
    ).toString("base64url");
  const token = `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  db.setSetting("lic", {
    user: { id: "u1" },
    token,
    ent: {
      source: "SUBSCRIPTION",
      features: { videoCompression: true },
      limits: {},
    },
    pending: [],
    lastSeen: T0,
    remaining: {},
  });
  const lic = createLicence({
    db,
    api: {
      request: async () => ({
        status: 426,
        data: {
          code: "UPGRADE_REQUIRED",
          minVersion: "2.0.0",
          error: "update",
        },
      }),
    },
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    now: () => T0,
    uuid: () => "job-1",
  });
  assert.ok(await lic.gate({ type: "video", options: {} }));
  assert.strictEqual(lic.state(true).updateRequired, "2.0.0");
  const s = await lic.refresh();
  assert.strictEqual(s.updateRequired, "2.0.0");
  assert.strictEqual(s.offline, true);
});
