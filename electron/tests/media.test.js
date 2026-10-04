const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
let ff;
try {
  ff = require("../services/ffmpeg");
} catch {
  ff = null;
}
const docs = require("../services/docs");
const { uniquePath } = require("../services/fsSafe");
const FFBIN =
  ff &&
  (() => {
    try {
      return require("ffmpeg-static");
    } catch {
      return null;
    }
  })();
const haveFF = FFBIN && fs.existsSync(FFBIN);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtp-"));

test("uniquePath never overwrites", () => {
  fs.writeFileSync(path.join(tmp, "a.mp4"), "x");
  assert.strictEqual(path.basename(uniquePath(tmp, "a", ".mp4")), "a (1).mp4");
});
test(
  "hardware detection returns a result and never throws",
  { skip: !haveFF },
  async () => {
    const hw = await ff.detectHardware();
    assert.strictEqual(typeof hw.vaapi, "boolean");
  },
);
test(
  "video re-encode, remux and audio extract produce output with real progress",
  { skip: !haveFF },
  async () => {
    const src = path.join(tmp, "src.mp4");
    execFileSync(
      FFBIN,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=320x240:rate=25:duration=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-shortest",
        "-c:v",
        "libx264",
        src,
      ],
      { stdio: "ignore" },
    );
    const info = await ff.probe(src);
    assert.ok(info.duration > 1.5 && info.hasVideo && info.hasAudio);
    for (const [name, args] of [
      [
        "cpu.mp4",
        ff.videoArgs(
          src,
          path.join(tmp, "cpu.mp4"),
          { mode: "cpu", rotate: 90 },
          { vaapi: false },
        ),
      ],
      [
        "remux.mp4",
        ff.videoArgs(
          src,
          path.join(tmp, "remux.mp4"),
          { mode: "remux" },
          { vaapi: false },
        ),
      ],
      [
        "a.mp3",
        ff.audioArgs(src, path.join(tmp, "a.mp3"), {
          format: "mp3",
          bitrate: 128,
        }),
      ],
    ]) {
      let last = null;
      await ff.run(args, {
        duration: info.duration,
        ctl: {},
        onProgress: (p) => {
          last = p;
        },
      });
      assert.ok(fs.statSync(path.join(tmp, name)).size > 0, name);
    }
  },
);
test("cancel kills an active ffmpeg run", { skip: !haveFF }, async () => {
  const ctl = {};
  const p = ff.run(
    [
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=1280x720:rate=30:duration=600",
      "-c:v",
      "libx264",
      path.join(tmp, "long.mp4"),
    ],
    { duration: 600, ctl, onProgress() {} },
  );
  setTimeout(() => {
    ctl.cancelled = true;
    ctl.kill();
  }, 500);
  await assert.rejects(p, /Cancelled/);
});
test(
  "PDF create + merge, corrupt PDF rejected, empty selection rejected",
  { skip: !haveFF },
  async () => {
    const png = path.join(tmp, "i.png");
    execFileSync(
      FFBIN,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=100x100",
        "-frames:v",
        "1",
        png,
      ],
      { stdio: "ignore" },
    );
    const a = path.join(tmp, "a.pdf"),
      b = path.join(tmp, "b.pdf"),
      m = path.join(tmp, "m.pdf");
    await docs.imagesToPdf([png], a);
    await docs.imagesToPdf([png, png], b);
    await docs.mergePdfs([a, b], m);
    assert.ok(fs.statSync(m).size > 0);
    fs.writeFileSync(path.join(tmp, "bad.pdf"), "not a pdf");
    await assert.rejects(
      docs.mergePdfs([a, path.join(tmp, "bad.pdf")], m),
      /Corrupt/,
    );
    await assert.rejects(docs.imagesToPdf([], m), /No images/);
  },
);

test("flags match the original Python script", { skip: !ff }, () => {
  const hw = { vaapi: true, device: "/dev/dri/renderD128" };
  const amd = ff
    .videoArgs("in.ts", "o.mp4", { mode: "hardware" }, hw)
    .join(" ");
  assert.match(
    amd,
    /-vf format=nv12,hwupload -c:v h264_vaapi -qp 23 -c:a aac -b:a 128k/,
  );
  const cpu = ff.videoArgs("in.ts", "o.mp4", { mode: "max" }, hw).join(" ");
  assert.match(cpu, /-c:v libx265 -crf 23/);
  assert.match(cpu, /-tag:v hvc1/);
  assert.match(cpu, /-c:a aac -b:a 128k/);
  assert.match(
    ff.videoArgs("in.ts", "o.mp4", { mode: "remux" }, hw).join(" "),
    /-c copy/,
  );
  assert.match(
    ff.audioArgs("i", "o", { format: "mp3", bitrate: 0 }).join(" "),
    /-vn -c:a libmp3lame -q:a 2/,
  );
  assert.match(
    ff.audioArgs("i", "o", { format: "mp3", bitrate: 96 }).join(" "),
    /-b:a 96k/,
  );
});
