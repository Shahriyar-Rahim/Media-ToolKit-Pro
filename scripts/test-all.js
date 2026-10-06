#!/usr/bin/env node
/*
 * Media Toolkit Pro - run EVERY test in one command.
 *
 *   node scripts/test-all.js                       # unit tests + real-file tests on ./test-media
 *   node scripts/test-all.js --media D:\my-files   # use another folder
 *   node scripts/test-all.js --electron            # also launch the real Electron app (end-to-end)
 *   node scripts/test-all.js --mongo mongodb://127.0.0.1:27017/mtp_test   # also the database tests (WIPES that DB)
 *   node scripts/test-all.js --help
 *
 * Put in the media folder (any names, any mix): some images (HEIC/JPG/PNG/WebP), a video, an audio file, and 2 PDFs.
 * Your originals are NEVER modified: every output goes to <media>/_test_output/<timestamp>/.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execFile } = require("child_process");

const root = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : d;
};
const HELP = `
Options
  --media <folder>     folder with your test files (default: ./test-media)
  --full               process whole videos (default: first 10 seconds of long videos, much faster)
  --clean              delete the generated output folder when finished (default: keep it so you can look at the results)
  --skip-unit          skip the desktop unit/UI tests
  --skip-backend       skip the backend tests
  --skip-media         skip the real-file tests
  --electron           also run the end-to-end test that launches the real Electron app (builds the UI first)
  --packaged           also test the packaged Linux build in release/ (run "npm run pack" first)
  --auto-sqlite        switch the SQLite module between Node and Electron builds automatically when a step needs it
  --mongo <uri>        also run the backend database tests against this MongoDB. The database is WIPED.
  --force-wipe         allow --mongo with a database name that does not contain "test"
`;
if (has("--help") || has("-h")) {
  console.log(HELP);
  process.exit(0);
}

// ---------- tiny test framework ----------
const tty = process.stdout.isTTY;
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => paint(32, s),
  red = (s) => paint(31, s),
  yellow = (s) => paint(33, s),
  dim = (s) => paint(90, s),
  bold = (s) => paint(1, s);
const results = [];
let section = "";
class Skip extends Error {}
const skip = (why) => {
  throw new Skip(why);
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const head = (t) => {
  section = t;
  console.log(`\n${bold(t)}\n${"-".repeat(t.length)}`);
};
async function check(name, fn) {
  const t0 = Date.now();
  let status = "PASS",
    detail = "";
  try {
    detail = (await fn()) || "";
  } catch (e) {
    if (e instanceof Skip) {
      status = "SKIP";
      detail = e.message;
    } else {
      status = "FAIL";
      detail = String(e.message || e)
        .split("\n")[0]
        .slice(0, 400);
    }
  }
  const ms = Date.now() - t0;
  results.push({ section, name, status, detail, ms });
  const tag =
    status === "PASS"
      ? green("PASS")
      : status === "FAIL"
        ? red("FAIL")
        : yellow("SKIP");
  console.log(
    `  ${tag}  ${name}${detail ? dim(`  - ${detail}`) : ""}${ms > 2000 ? dim(`  (${(ms / 1000).toFixed(1)}s)`) : ""}`,
  );
}
const sh = (cmd, args, opts = {}) =>
  new Promise((res, rej) =>
    execFile(cmd, args, { maxBuffer: 1 << 26, ...opts }, (e, out, err) =>
      e
        ? rej(
            new Error(
              (err || e.message)
                .toString()
                .trim()
                .split("\n")
                .slice(-3)
                .join(" "),
            ),
          )
        : res(out.toString()),
    ),
  );
const winShell = process.platform === "win32";
const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    shell: winShell,
    ...opts,
  });

// SQLite can be built for Node (unit tests) OR for Electron (the app); it cannot be both at once.
function sqliteIsNodeBuild() {
  try {
    const D = require(path.join(root, "node_modules", "better-sqlite3"));
    new D(":memory:").close();
    return true;
  } catch {
    return false;
  }
}
function switchSqlite(target) {
  if (!has("--auto-sqlite")) return false;
  console.log(dim(`  (switching SQLite to the ${target} build...)`));
  const r =
    target === "node"
      ? run("npm", ["rebuild", "better-sqlite3"])
      : run("npx", ["electron-builder", "install-app-deps"]);
  return r.status === 0;
}

// ---------- TAP runner for node:test suites ----------
function listTests(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".test.js"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}
function runSuite(files, cwd, env = {}) {
  const r = spawnSync(process.execPath, ["--test", ...files], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const n = (k) =>
    +((new RegExp(`^# ${k} (\\d+)`, "m").exec(out) || [])[1] || 0);
  return {
    tests: n("tests"),
    pass: n("pass"),
    fail: n("fail"),
    skipped: n("skipped"),
    failed: [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]),
    out,
  };
}
function suiteCheck(label, files, cwd, env) {
  return check(label, () => {
    if (!files.length) skip("no test files found");
    const s = runSuite(files, cwd, env);
    if (s.fail > 0 || s.tests === 0) {
      console.log(dim(s.out.split("\n").slice(-30).join("\n")));
      throw new Error(
        s.tests === 0
          ? "the test runner produced no results"
          : `${s.fail} failed: ${s.failed.join(" | ")}`,
      );
    }
    return `${s.pass} passed${s.skipped ? `, ${s.skipped} skipped` : ""}`;
  });
}

// ---------- 1. environment ----------
async function environment() {
  head("Environment");
  await check("Node.js 18 or newer", () => {
    assert(
      +process.versions.node.split(".")[0] >= 18,
      `found ${process.version}`,
    );
    return process.version;
  });
  await check("desktop dependencies are installed", () => {
    for (const m of [
      "sharp",
      "ffmpeg-static",
      "ffprobe-static",
      "pdf-lib",
      "heic-convert",
    ]) {
      try {
        require.resolve(m, { paths: [root] });
      } catch {
        throw new Error(`"${m}" is missing - run "npm install" in ${root}`);
      }
    }
  });
  await check(
    "FFmpeg binary runs",
    async () => (await sh(FFMPEG(), ["-version"])).split("\n")[0],
  );
  await check("sharp (image library) loads", () => {
    const s = require(path.join(root, "node_modules", "sharp"));
    return `libvips ${s.versions.vips}`;
  });
  await check("hardware video encoder detection", async () => {
    const hw = await require(
      path.join(root, "electron/services/ffmpeg"),
    ).detectHardware();
    return hw.vaapi
      ? `VAAPI GPU encoding available (${hw.device})`
      : hw.hwEncoder
        ? `GPU encoder: ${hw.hwEncoder}`
        : `no GPU encoder - CPU fallback will be used (${hw.reason || "n/a"})`;
  });
  await check("SQLite module build", () =>
    sqliteIsNodeBuild()
      ? "built for Node: SQLite unit tests will run"
      : 'built for Electron (normal after "npm install"): SQLite unit tests will be skipped',
  );
  await check("free disk space", () => {
    try {
      const s = fs.statfsSync(os.tmpdir());
      const gb = (s.bavail * s.bsize) / 1e9;
      assert(gb > 1, `only ${gb.toFixed(1)} GB free`);
      return `${gb.toFixed(0)} GB free`;
    } catch (e) {
      if (/GB free/.test(e.message)) throw e;
      skip("could not read free space");
    }
  });
}
const FFMPEG = () => require(path.join(root, "node_modules", "ffmpeg-static"));
const FFPROBE = () =>
  require(path.join(root, "node_modules", "ffprobe-static")).path;

// ---------- 2 & 3. unit suites ----------
async function unitTests() {
  head("Desktop unit + UI tests");
  if (!sqliteIsNodeBuild() && switchSqlite("node")) {
    /* switched */
  }
  await suiteCheck(
    "queue, IPC validation, FFmpeg, PDF, HEIC worker, entitlement, logger, updater, React UI flows",
    [
      ...listTests(path.join(root, "electron", "tests")),
      ...listTests(path.join(root, "tests")),
    ],
    root,
  );
}
async function backendTests() {
  head("Backend tests");
  const dir = path.join(root, "server");
  await check("backend dependencies are installed", () => {
    if (!fs.existsSync(path.join(dir, "node_modules")))
      skip('run "npm install" inside server/ first');
  });
  let env = {};
  const uri = val("--mongo", "");
  if (uri) {
    const name = uri.split("?")[0].split("/").pop() || "";
    if (!/test/i.test(name) && !has("--force-wipe")) {
      await check("database tests", () => {
        throw new Error(
          `refusing: database "${name}" does not look like a throwaway test database (its name must contain "test"). Use --force-wipe to override.`,
        );
      });
    } else env = { MONGODB_TEST_URI: uri };
  }
  await suiteCheck(
    `backend logic + HTTP tests${env.MONGODB_TEST_URI ? " + DATABASE integration tests (database is wiped)" : ""}`,
    listTests(path.join(dir, "tests")),
    dir,
    env,
  );
  if (!env.MONGODB_TEST_URI)
    await check(
      "database integration tests (payments, refunds, OTP, discounts)",
      () =>
        skip(
          "not run: add --mongo mongodb://127.0.0.1:27017/mtp_test (the database is wiped)",
        ),
    );
}

// ---------- 4. real files ----------
const EXT = {
  image: [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".heif",
    ".tif",
    ".tiff",
    ".bmp",
    ".gif",
    ".avif",
  ],
  video: [
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
    ".ts",
    ".tmp",
    ".m4v",
    ".webm",
    ".flv",
    ".wmv",
  ],
  audio: [".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg", ".opus", ".wma"],
  pdf: [".pdf"],
};
function discover(dir) {
  const found = { image: [], video: [], audio: [], pdf: [] };
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (!fs.statSync(p).isFile()) continue;
    const e = path.extname(f).toLowerCase();
    for (const k of Object.keys(EXT)) if (EXT[k].includes(e)) found[k].push(p);
  }
  return found;
}
const fingerprint = (p) => {
  const st = fs.statSync(p);
  return `${st.size}:${crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex")}`;
};
const probe = async (f) =>
  JSON.parse(
    await sh(FFPROBE(), [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      f,
    ]),
  );
const vs = (p) => p.streams.find((s) => s.codec_type === "video"),
  as = (p) => p.streams.find((s) => s.codec_type === "audio"),
  dur = (p) => parseFloat(p.format.duration);
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

async function realFiles() {
  head("Real files");
  const dir = path.resolve(val("--media", path.join(root, "test-media")));
  if (!fs.existsSync(dir)) {
    await check(`media folder ${dir}`, () =>
      skip(
        `does not exist. Create it and put some images, a video, an audio file and 2 PDFs inside, then run again.`,
      ),
    );
    return;
  }
  const found = discover(dir);
  const total = Object.values(found).reduce((a, b) => a + b.length, 0);
  console.log(
    dim(
      `  folder: ${dir}\n  found: ${found.image.length} image(s), ${found.video.length} video(s), ${found.audio.length} audio, ${found.pdf.length} PDF(s)`,
    ),
  );
  if (!total) {
    await check("files in the media folder", () =>
      skip("the folder has no supported files"),
    );
    return;
  }

  const out = path.join(
    dir,
    "_test_output",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  fs.mkdirSync(out, { recursive: true });
  const before = new Map(
    Object.values(found)
      .flat()
      .map((p) => [p, fingerprint(p)]),
  );
  const ff = require(path.join(root, "electron/services/ffmpeg"));
  const { JobQueue } = require(path.join(root, "electron/services/jobQueue"));
  const { makeRunners } = require(path.join(root, "electron/services/runners"));
  const { validateEnqueue } = require(path.join(root, "electron/ipc/validate"));
  const { PDFDocument } = require(path.join(root, "node_modules", "pdf-lib"));
  const sharp = require(path.join(root, "node_modules", "sharp"));

  const rows = [];
  let jobs = 0;
  const mkQueue = (settings) =>
    new JobQueue({
      concurrency: 2,
      runners: makeRunners({
        db: { addHistory: (r) => rows.push(r) },
        getSettings: () => settings,
      }),
      onUpdate() {},
    });
  const queue = mkQueue({ outputMode: "custom", outputDir: out });
  const waitJob = async (q, id) => {
    for (;;) {
      const j = q.list().find((x) => x.id === id);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(j.status)) return j;
      await sleep(100);
    }
  };
  const runJob = async (type, input, options = {}, q = queue) => {
    const v = validateEnqueue({ type, input, options });
    jobs++;
    return waitJob(q, q.enqueue(v.type, v.input, v.options));
  }; // the same validation the app's IPC layer applies
  const okJob = (j) => {
    assert(j.status === "COMPLETED", `${j.status}: ${j.error || "no details"}`);
    assert(
      fs.existsSync(j.output) && fs.statSync(j.output).size > 0,
      "output file is missing or empty",
    );
    return j;
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  // ---- video ----
  for (const src of found.video.slice(0, 3)) {
    const base = path.basename(src);
    const ext = path.extname(src);
    const info = await probe(src);
    let work = src;
    if (!has("--full") && dur(info) > 15) {
      // long videos: use the first 10 seconds so the whole run stays quick
      const clip = path.join(out, `${path.basename(src, ext)}_clip${ext}`);
      try {
        await sh(FFMPEG(), [
          "-y",
          "-v",
          "error",
          "-ss",
          "0",
          "-t",
          "10",
          "-i",
          src,
          "-c",
          "copy",
          clip,
        ]);
        if (dur(await probe(clip)) > 2) work = clip;
      } catch {
        /* fall back to the whole file */
      }
    }
    const winfo = await probe(work);
    const D = dur(winfo);
    const v0 = vs(winfo);
    console.log(
      dim(
        `  ${base}: ${v0 ? `${v0.codec_name} ${v0.width}x${v0.height}` : "no video stream"}, ${D.toFixed(1)}s, ${as(winfo) ? `audio ${as(winfo).codec_name}` : "no audio"}${work !== src ? " (testing a 10 s clip; use --full for the whole file)" : ""}`,
      ),
    );
    if (!v0) {
      await check(`${base}: has a video stream`, () => {
        throw new Error("this file has no video stream");
      });
      continue;
    }
    const plain = {};
    await check(
      `${base}: remux (copy streams, no re-encode) keeps codec and length`,
      async () => {
        const j = okJob(await runJob("video", work, { mode: "remux" }));
        const o = await probe(j.output);
        assert(
          vs(o).codec_name === v0.codec_name,
          `codec changed ${v0.codec_name} -> ${vs(o).codec_name}`,
        );
        assert(
          near(dur(o), D, Math.max(1.5, D * 0.03)),
          `duration ${dur(o).toFixed(1)}s vs ${D.toFixed(1)}s`,
        );
        return `${mb(fs.statSync(j.output).size)}`;
      },
    );
    await check(`${base}: CPU H.264 re-encode`, async () => {
      const j = okJob(await runJob("video", work, { mode: "cpu" }));
      const o = await probe(j.output);
      plain.w = vs(o).width;
      plain.h = vs(o).height;
      assert(vs(o).codec_name === "h264", `codec is ${vs(o).codec_name}`);
      assert(
        near(dur(o), D, Math.max(1.5, D * 0.03)),
        `duration ${dur(o).toFixed(1)}s vs ${D.toFixed(1)}s`,
      );
      if (as(winfo)) assert(as(o), "audio track was lost");
      return `${mb(fs.statSync(work).size)} -> ${mb(fs.statSync(j.output).size)}`;
    });
    await check(
      `${base}: rotate 90 degrees swaps width and height`,
      async () => {
        const j = okJob(
          await runJob("video", work, { mode: "cpu", rotate: 90 }),
        );
        const o = vs(await probe(j.output));
        if (!plain.w) skip("needs the CPU re-encode test above to pass");
        assert(
          near(o.width, plain.h, 2) && near(o.height, plain.w, 2),
          `got ${o.width}x${o.height}, expected ${plain.h}x${plain.w}`,
        );
        return `${plain.w}x${plain.h} -> ${o.width}x${o.height}`;
      },
    );
    await check(
      `${base}: maximum compression (H.265 / HEVC, hvc1 tag)`,
      async () => {
        const j = okJob(
          await runJob("video", work, { mode: "max", preset: "fast" }),
        );
        const o = vs(await probe(j.output));
        assert(o.codec_name === "hevc", `codec is ${o.codec_name}`);
        assert(o.codec_tag_string === "hvc1", `tag is ${o.codec_tag_string}`);
        return `${mb(fs.statSync(work).size)} -> ${mb(fs.statSync(j.output).size)}`;
      },
    );
    await check(
      `${base}: hardware mode (GPU if available, otherwise automatic CPU fallback)`,
      async () => {
        const hw = await ff.detectHardware();
        const j = okJob(await runJob("video", work, { mode: "hardware" }));
        assert(
          vs(await probe(j.output)).codec_name === "h264",
          "output is not H.264",
        );
        return hw.vaapi || hw.hwEncoder
          ? `GPU path used (${hw.hwEncoder || "vaapi"})`
          : "no GPU here: fell back to CPU as designed";
      },
    );
    if (as(winfo)) {
      for (const [fmt, codec, label] of [
        ["mp3", "mp3", "MP3 (best-quality VBR)"],
        ["flac", "flac", "FLAC"],
        ["wav", "pcm_s16le", "WAV"],
        ["aac", "aac", "AAC"],
      ]) {
        await check(`${base}: extract audio to ${label}`, async () => {
          const j = okJob(
            await runJob("audio", work, {
              format: fmt,
              ...(fmt === "mp3"
                ? { bitrate: 0 }
                : fmt === "aac"
                  ? { bitrate: 128 }
                  : {}),
            }),
          );
          const o = await probe(j.output);
          assert(as(o).codec_name === codec, `codec is ${as(o).codec_name}`);
          assert(!vs(o), "output still has video");
          assert(
            near(dur(o), D, Math.max(1.5, D * 0.03)),
            `duration ${dur(o).toFixed(1)}s vs ${D.toFixed(1)}s`,
          );
          return mb(fs.statSync(j.output).size);
        });
      }
    } else
      await check(
        `${base}: extracting audio from a video with no sound fails clearly`,
        async () => {
          const j = await runJob("audio", work, { format: "mp3" });
          assert(
            j.status === "FAILED" && /no audio/i.test(j.error),
            `got ${j.status}: ${j.error}`,
          );
          return j.error;
        },
      );
    if (src === found.video[0]) {
      await check(
        "running the same job twice never overwrites the first result",
        async () => {
          const a = okJob(await runJob("video", work, { mode: "remux" })),
            b = okJob(await runJob("video", work, { mode: "remux" }));
          assert(
            a.output !== b.output && /\(\d+\)\.\w+$/.test(b.output),
            `second file is ${path.basename(b.output)}`,
          );
          return path.basename(b.output);
        },
      );
      await check(
        "cancelling a running H.265 encode stops it and leaves no partial file",
        async () => {
          const probeIn = path.join(out, `cancel_probe${path.extname(work)}`);
          fs.copyFileSync(work, probeIn);
          const v = validateEnqueue({
            type: "video",
            input: probeIn,
            options: { mode: "max", preset: "slower" },
          });
          jobs++;
          const id = queue.enqueue(v.type, v.input, v.options);
          await sleep(2000);
          if (queue.list().find((j) => j.id === id).status !== "PROCESSING") {
            await waitJob(queue, id);
            skip(
              "the encode finished before it could be cancelled (clip too small/short for this test)",
            );
          }
          queue.cancel(id);
          const j = await waitJob(queue, id);
          await sleep(500);
          assert(j.status === "CANCELLED", `status is ${j.status}`);
          const left = fs
            .readdirSync(out)
            .filter((f) => f.startsWith("cancel_probe_compressed"));
          assert(!left.length, `partial file left behind: ${left.join(", ")}`);
          return "cancelled cleanly";
        },
      );
    }
  }
  if (!found.video.length)
    await check("video tests", () => skip("no video in the folder"));

  // ---- audio ----
  for (const src of found.audio.slice(0, 3)) {
    const base = path.basename(src);
    const info = await probe(src);
    const D = dur(info);
    console.log(dim(`  ${base}: ${as(info).codec_name}, ${D.toFixed(1)}s`));
    await check(`${base}: compress to 96 kbps MP3`, async () => {
      const j = okJob(
        await runJob("audio", src, { format: "mp3", bitrate: 96 }),
      );
      const o = await probe(j.output);
      const br = +o.format.bit_rate;
      assert(as(o).codec_name === "mp3", "not MP3");
      assert(
        br > 70000 && br < 125000,
        `bitrate ${Math.round(br / 1000)} kbps`,
      );
      assert(
        near(dur(o), D, 1),
        `duration ${dur(o).toFixed(1)}s vs ${D.toFixed(1)}s`,
      );
      return `${mb(fs.statSync(src).size)} -> ${mb(fs.statSync(j.output).size)}`;
    });
    for (const [fmt, codec] of [
      ["aac", "aac"],
      ["flac", "flac"],
      ["wav", "pcm_s16le"],
    ])
      await check(`${base}: convert to ${fmt.toUpperCase()}`, async () => {
        const j = okJob(
          await runJob("audio", src, {
            format: fmt,
            ...(fmt === "aac" ? { bitrate: 128 } : {}),
          }),
        );
        const o = await probe(j.output);
        assert(as(o).codec_name === codec, `codec is ${as(o).codec_name}`);
        assert(
          near(dur(o), D, 1),
          `duration ${dur(o).toFixed(1)}s vs ${D.toFixed(1)}s`,
        );
        return mb(fs.statSync(j.output).size);
      });
  }
  if (!found.audio.length)
    await check("audio tests", () => skip("no audio file in the folder"));

  // ---- images ----
  const converted = [];
  for (const src of found.image.slice(0, 20)) {
    const base = path.basename(src);
    await check(`${base}: convert to JPG`, async () => {
      const j = okJob(await runJob("heic", src, { quality: 90 }));
      const b = fs.readFileSync(j.output);
      assert(
        b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
        "output is not a JPEG",
      );
      const m = await sharp(j.output).metadata();
      assert(m.width > 0 && m.height > 0, "JPEG has no size");
      converted.push(src);
      return `${m.width}x${m.height}, ${mb(b.length)}`;
    });
  }
  if (found.image.length) {
    const set = found.image.slice(0, 15);
    await check(
      `${set.length} image(s) -> one PDF, in order, HEIC included`,
      async () => {
        const j = await runJob("imagesToPdf", set, { filename: "all_images" });
        if (
          j.status === "FAILED" &&
          /Unsupported or damaged image/.test(j.error)
        )
          throw new Error(j.error);
        okJob(j);
        const pdf = await PDFDocument.load(fs.readFileSync(j.output));
        assert(
          pdf.getPageCount() === set.length,
          `${pdf.getPageCount()} pages for ${set.length} images`,
        );
        return `${pdf.getPageCount()} pages, ${mb(fs.statSync(j.output).size)}`;
      },
    );
  } else await check("image tests", () => skip("no images in the folder"));
  const junk = path.join(out, "not_an_image.png");
  fs.writeFileSync(junk, "this is not an image");
  await check(
    "a damaged image fails with a short, friendly message (no crash, no stack trace)",
    async () => {
      const j = await runJob("heic", junk, { quality: 90 });
      assert(j.status === "FAILED", `status is ${j.status}`);
      assert(
        j.error.length < 250 &&
          !/\n\s+at /.test(j.error) &&
          !j.error.includes(out),
        `message: ${j.error}`,
      );
      return j.error;
    },
  );

  // ---- PDFs ----
  if (found.pdf.length) {
    const inputs =
      found.pdf.length >= 2
        ? found.pdf.slice(0, 6)
        : [found.pdf[0], found.pdf[0]];
    const counts = [];
    for (const p of inputs)
      counts.push((await PDFDocument.load(fs.readFileSync(p))).getPageCount());
    await check(
      `merge ${inputs.length} PDFs${found.pdf.length < 2 ? " (only one PDF found: merging it with itself)" : ""}, order preserved`,
      async () => {
        const j = okJob(
          await runJob("mergePdf", inputs, { filename: "merged" }),
        );
        const m = await PDFDocument.load(fs.readFileSync(j.output));
        const want = counts.reduce((a, b) => a + b, 0);
        assert(
          m.getPageCount() === want,
          `${m.getPageCount()} pages, expected ${want}`,
        );
        const first = (await PDFDocument.load(fs.readFileSync(inputs[0])))
          .getPage(0)
          .getSize();
        const got = m.getPage(0).getSize();
        assert(
          near(first.width, got.width, 1) && near(first.height, got.height, 1),
          "first page is not from the first PDF",
        );
        return `${counts.join(" + ")} = ${m.getPageCount()} pages`;
      },
    );
    const bad = path.join(out, "damaged.pdf");
    fs.writeFileSync(bad, "%PDF-1.4 this file is damaged");
    await check(
      "a damaged PDF in the list fails clearly and names the file",
      async () => {
        const j = await runJob("mergePdf", [inputs[0], bad], {
          filename: "should_not_exist",
        });
        assert(
          j.status === "FAILED" &&
            /damaged\.pdf/.test(j.error) &&
            /Corrupt/.test(j.error),
          `got ${j.status}: ${j.error}`,
        );
        assert(
          !fs.existsSync(path.join(out, "should_not_exist.pdf")),
          "a partial PDF was written",
        );
        return j.error;
      },
    );
    await check(
      "merging a single PDF is refused with a clear message",
      async () => {
        const j = await runJob("mergePdf", [inputs[0]], {});
        assert(
          j.status === "FAILED" && /at least two/i.test(j.error),
          `got ${j.status}: ${j.error}`,
        );
        return j.error;
      },
    );
  } else await check("PDF tests", () => skip("no PDFs in the folder"));

  // ---- error handling and safety ----
  head("Error handling and safety (real files)");
  await check("a missing input file fails clearly", async () => {
    const j = await runJob("video", path.join(out, "does-not-exist.mp4"), {
      mode: "cpu",
    });
    assert(
      j.status === "FAILED" && /missing or unreadable/i.test(j.error),
      `got ${j.status}: ${j.error}`,
    );
    return j.error;
  });
  await check(
    "a corrupt video fails with a short message and the app keeps working",
    async () => {
      const g = path.join(out, "garbage.mp4");
      fs.writeFileSync(g, crypto.randomBytes(5000));
      const j = await runJob("video", g, { mode: "cpu" });
      assert(j.status === "FAILED", `status ${j.status}`);
      assert(
        j.error.length < 600 && !/\n\s+at /.test(j.error),
        `message too raw: ${j.error.slice(0, 200)}`,
      );
      if (found.audio.length)
        okJob(
          await runJob("audio", found.audio[0], {
            format: "mp3",
            bitrate: 128,
          }),
        );
      return "failed cleanly, next job still works";
    },
  );
  await check(
    "an unwritable output folder is reported before any work starts",
    async () => {
      const blocker = path.join(out, "blocker.txt");
      fs.writeFileSync(blocker, "x");
      const q = mkQueue({
        outputMode: "custom",
        outputDir: path.join(blocker, "sub"),
      });
      const src = found.audio[0] || found.image[0] || found.pdf[0];
      if (!src) skip("no input file");
      const type = found.audio[0]
        ? "audio"
        : found.image[0]
          ? "heic"
          : "mergePdf";
      const j = await runJob(
        type,
        type === "mergePdf" ? [src, src] : src,
        type === "audio"
          ? { format: "mp3", bitrate: 128 }
          : type === "heic"
            ? { quality: 90 }
            : {},
        q,
      );
      assert(
        j.status === "FAILED" && /not accessible/i.test(j.error),
        `got ${j.status}: ${j.error}`,
      );
      return j.error.split(":")[0];
    },
  );
  await check(
    "history record per job, with sizes for successes and success=0 for failures",
    () => {
      assert(
        rows.length === jobs,
        `${rows.length} history rows for ${jobs} jobs`,
      );
      const okRows = rows.filter((r) => r.success),
        badRows = rows.filter((r) => !r.success);
      assert(
        okRows.every(
          (r) => r.output_size > 0 && r.input_size > 0 && r.ratio > 0,
        ),
        "a successful row has missing sizes",
      );
      assert(
        badRows.every((r) => !r.output_path),
        "a failed row points to an output file",
      );
      return `${rows.length} jobs: ${okRows.length} succeeded, ${badRows.length} failed/cancelled`;
    },
  );
  await check("your original files were not modified, moved or deleted", () => {
    for (const [p, fp] of before) {
      assert(fs.existsSync(p), `${path.basename(p)} is gone`);
      assert(fingerprint(p) === fp, `${path.basename(p)} changed`);
    }
    return `${before.size} originals verified byte-for-byte`;
  });
  console.log(dim(`\n  Results are in: ${out}`));
  if (has("--clean")) {
    fs.rmSync(out, { recursive: true, force: true });
    console.log(dim("  (--clean: output folder removed)"));
  }
}

// ---------- 6. end-to-end (optional) ----------
async function electronE2E() {
  head("Real Electron app (end to end)");
  await check("prerequisites", () => {
    if (
      process.platform === "linux" &&
      !process.env.DISPLAY &&
      run("which", ["xvfb-run"], { shell: false }).status !== 0
    )
      skip('Linux needs a display or xvfb ("sudo apt install xvfb")');
    if (sqliteIsNodeBuild() && !switchSqlite("electron"))
      skip(
        "SQLite is built for Node, but the app needs the Electron build. Run: npx electron-builder install-app-deps   (or add --auto-sqlite)",
      );
  });
  if (results[results.length - 1].status !== "PASS") return;
  await check("build the UI", () => {
    const r = run("npx", ["vite", "build"]);
    assert(r.status === 0, "vite build failed");
  });
  await check("launch the app and run the end-to-end checks", () => {
    const r = run(
      process.execPath,
      [path.join(root, "scripts", "smoke-electron.js")],
      { shell: false, env: { ...process.env, SMOKE_TIMEOUT_MS: "300000" } },
    );
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    const m = /(\d+)\/(\d+) checks passed/.exec(out);
    const fails = [...out.matchAll(/^FAIL\s+(.+)$/gm)].map((x) => x[1]);
    if (!m) {
      console.log(dim(out.split("\n").slice(-25).join("\n")));
      throw new Error("the app did not report results");
    }
    if (fails.length || m[1] !== m[2])
      throw new Error(`${m[1]}/${m[2]} passed. Failed: ${fails.join(" | ")}`);
    return `${m[1]}/${m[2]} checks passed`;
  });
}
async function packagedE2E() {
  head("Packaged app");
  await check("packaged build smoke test", () => {
    if (process.platform !== "linux") skip("this check runs on Linux only");
    if (!fs.existsSync(path.join(root, "release", "linux-unpacked")))
      skip("no package found. Run: npm run pack");
    const r = run(
      process.execPath,
      [path.join(root, "scripts", "smoke-packaged.js")],
      { shell: false },
    );
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    const m = /(\d+)\/(\d+) checks passed/.exec(out);
    if (!m || m[1] !== m[2]) {
      console.log(dim(out.split("\n").slice(-20).join("\n")));
      throw new Error(m ? `${m[1]}/${m[2]} passed` : "no result");
    }
    return `${m[1]}/${m[2]} checks passed`;
  });
}

// ---------- main ----------
(async () => {
  const t0 = Date.now();
  console.log(bold("Media Toolkit Pro - full test run"));
  console.log(
    dim(
      `${new Date().toLocaleString()}  |  ${os.platform()} ${os.arch()}  |  Node ${process.version}`,
    ),
  );
  await environment();
  if (!has("--skip-unit")) await unitTests();
  if (!has("--skip-backend")) await backendTests();
  if (!has("--skip-media")) await realFiles();
  if (has("--electron")) await electronE2E();
  if (has("--packaged")) await packagedE2E();
  const n = (s) => results.filter((r) => r.status === s).length;
  const failed = results.filter((r) => r.status === "FAIL");
  console.log(
    `\n${bold("Summary")}\n-------\n  ${green(`${n("PASS")} passed`)}   ${failed.length ? red(`${failed.length} failed`) : "0 failed"}   ${yellow(`${n("SKIP")} skipped`)}   (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
  if (failed.length) {
    console.log(red("\nFailures:"));
    failed.forEach((f) =>
      console.log(`  [${f.section}] ${f.name}\n      ${f.detail}`),
    );
  }
  const skipped = results.filter((r) => r.status === "SKIP");
  if (skipped.length) {
    console.log(yellow("\nSkipped (not failures):"));
    skipped.forEach((s) => console.log(`  ${s.name}: ${s.detail}`));
  }
  const report = path.join(root, "test-report.json");
  fs.writeFileSync(
    report,
    JSON.stringify(
      {
        when: new Date().toISOString(),
        platform: `${os.platform()} ${os.arch()}`,
        node: process.version,
        summary: { pass: n("PASS"), fail: failed.length, skip: n("SKIP") },
        results,
      },
      null,
      2,
    ),
  );
  console.log(dim(`\nFull report: ${report}`));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(red(`\nThe test runner itself crashed: ${e.stack || e}`));
  process.exit(2);
});
