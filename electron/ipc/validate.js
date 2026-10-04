const path = require("path");
const fail = (m) => {
  throw new Error(`Invalid request: ${m}`);
};
const isStr = (v, max = 4096) =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const isAbs = (v) => isStr(v) && path.isAbsolute(v);
const oneOf = (v, list, name) => list.includes(v) || fail(`${name}`);
const int = (v, min, max, name) =>
  (Number.isInteger(v) && v >= min && v <= max) || fail(name);

const TYPES = ["video", "audio", "heic", "imagesToPdf", "mergePdf"];

function validateEnqueue(p) {
  if (!p || typeof p !== "object") fail("payload");
  oneOf(p.type, TYPES, "type");
  const multi = p.type === "imagesToPdf" || p.type === "mergePdf";
  const inputs = multi ? p.input : [p.input];
  if (
    !Array.isArray(inputs) ||
    !inputs.length ||
    inputs.length > 500 ||
    !inputs.every(isAbs)
  )
    fail("input paths");
  const o = p.options && typeof p.options === "object" ? p.options : {};
  const clean = {};
  if (p.type === "video") {
    clean.mode =
      oneOf(o.mode ?? "cpu", ["hardware", "cpu", "max", "remux"], "mode") &&
      (o.mode ?? "cpu");
    if (o.rotate != null) {
      oneOf(o.rotate, [0, 90, 180, 270], "rotate");
      clean.rotate = o.rotate;
    }
    if (o.crf != null) {
      int(o.crf, 0, 51, "crf");
      clean.crf = o.crf;
    }
    if (o.qp != null) {
      int(o.qp, 0, 51, "qp");
      clean.qp = o.qp;
    }
    if (o.preset != null) {
      oneOf(o.preset, ["fast", "medium", "slow", "slower"], "preset");
      clean.preset = o.preset;
    }
    clean.suffix = "_compressed";
  }
  if (p.type === "audio") {
    clean.format =
      oneOf(o.format, ["mp3", "aac", "wav", "flac"], "format") && o.format;
    if (o.bitrate != null) {
      oneOf(o.bitrate, [0, 96, 128, 192, 256, 320], "bitrate");
      clean.bitrate = o.bitrate;
    }
    clean.suffix = "_audio";
  }
  if (p.type === "heic") {
    clean.quality =
      o.quality == null ? 92 : (int(o.quality, 30, 100, "quality"), o.quality);
  }
  if (multi && o.filename != null) {
    isStr(o.filename, 120) || fail("filename");
    clean.filename = o.filename.replace(/\.pdf$/i, "");
  }
  const batchSize =
    p.batchSize == null
      ? 1
      : (int(p.batchSize, 1, 500, "batchSize"), p.batchSize);
  return {
    type: p.type,
    input: multi ? inputs : inputs[0],
    options: clean,
    batchSize,
  };
}
module.exports = { validateEnqueue, isAbs, isStr, fail, oneOf, int };
