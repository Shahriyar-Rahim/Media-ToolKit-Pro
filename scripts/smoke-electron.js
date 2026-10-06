// Launches the REAL app (Electron + built UI) under a virtual display, with a tiny fake API server standing in for the backend.
// Usage: npm run build:ui && node scripts/smoke-electron.js     (needs xvfb-run on Linux)
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.join(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtp-smoke-"));
const FF = require("ffmpeg-static");
const ff = (...a) => execFileSync(FF, ["-y", "-loglevel", "error", ...a]);
ff(
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=320x240:rate=25:duration=3",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=3",
  "-shortest",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  path.join(dir, "vid.mp4"),
);
ff(
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=1280x720:rate=25:duration=40",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-pix_fmt",
  "yuv420p",
  path.join(dir, "long.mp4"),
);
for (const n of ["p1", "p2"])
  ff(
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=200x150",
    "-frames:v",
    "1",
    path.join(dir, `${n}.png`),
  );
fs.writeFileSync(path.join(dir, "not-a-video.mp4"), "this is not a video");
const features = Object.fromEntries(
  [
    "videoCompression",
    "hardwareAcceleration",
    "maximumCompression",
    "audioConversion",
    "heicConversion",
    "pdfCreate",
    "pdfMerge",
    "batchProcessing",
    "mediaVault",
  ].map((f) => [f, true]),
);
const ent = {
  source: "SUBSCRIPTION",
  planName: "Smoke plan",
  lifetime: true,
  features,
  limits: {},
  remaining: {},
};
const api = http.createServer((req, res) => {
  const send = (o, s = 200) => {
    res.writeHead(s, { "content-type": "application/json" });
    res.end(JSON.stringify(o));
  };
  if (req.url === "/api/auth/me")
    return send({
      user: {
        id: "u1",
        email: "smoke@test.dev",
        name: "Smoke",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
  if (req.url === "/api/usage/entitlement")
    return send({ entitlement: ent, snapshot: null });
  if (req.url === "/api/usage/consume")
    return send({ ok: true, entitlement: ent });
  send({ error: "not found" }, 404);
});
const preview = spawn(
  "npx",
  ["vite", "preview", "--port", "5173", "--strictPort"],
  { cwd: root, stdio: "ignore" },
); // the app loads http://localhost:5173 when not packaged
api.listen(0, async () => {
  for (let i = 0; i < 60; i++) {
    const up = await new Promise((r) =>
      http
        .get("http://localhost:5173/", (res) => {
          res.resume();
          r(res.statusCode === 200);
        })
        .on("error", () => r(false)),
    );
    if (up) break;
    await new Promise((r) => setTimeout(r, 500));
  } // wait for the static server
  const env = {
    ...process.env,
    MTP_API_URL: `http://127.0.0.1:${api.address().port}`,
    MTP_SMOKE_DIR: dir,
  };
  const p = spawn(
    "xvfb-run",
    [
      "-a",
      path.join(root, "node_modules/.bin/electron"),
      "--no-sandbox",
      `--user-data-dir=${path.join(dir, "userdata")}`,
      path.join(__dirname, "smoke-main.js"),
    ],
    { env },
  );
  let out = "";
  p.stdout.on("data", (d) => {
    out += d;
  });
  p.stderr.on("data", (d) => {
    out += d;
  });
  const kill = setTimeout(() => {
    console.log(
      "TIMEOUT. Output tail:\n" +
        out
          .split("\n")
          .filter((l) => !/ERROR:(bus|viz_main|socket_posix|gpu_)|dbus/.test(l))
          .join("\n")
          .slice(-2500),
    );
    p.kill("SIGKILL");
  }, +process.env.SMOKE_TIMEOUT_MS || 240000);
  p.on("close", () => {
    clearTimeout(kill);
    preview.kill();
    api.close();
    const m = /SMOKE_RESULT:(.*)/.exec(out);
    if (!m) {
      console.log("No result from the app. Output tail:\n" + out.slice(-1500));
      process.exit(2);
    }
    const rs = JSON.parse(m[1]);
    for (const r of rs)
      console.log(
        `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.detail}`}`,
      );
    console.log(
      `\n${rs.filter((r) => r.ok).length}/${rs.length} checks passed. Screenshot: ${path.join(dir, "home.png")}`,
    );
    process.exit(rs.every((r) => r.ok) ? 0 : 1);
  });
});
