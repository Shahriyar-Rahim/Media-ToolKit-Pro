// Runs in its OWN process (never inside the app's main process). Sharp, libvips and the HEIC decoder are native or heavy code:
// if one of them crashes or aborts, only this short-lived process dies and the job fails with a friendly message.
const fs = require("fs");
const path = require("path");

const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "mif1",
  "msf1",
]);
// Decided by file CONTENT, not extension. The prebuilt sharp has no HEVC decoder, so HEIC must never be given to sharp.
async function isHeif(file) {
  const fh = await fs.promises.open(file, "r");
  try {
    const b = Buffer.alloc(12);
    await fh.read(b, 0, 12, 0);
    return (
      b.toString("latin1", 4, 8) === "ftyp" &&
      HEIF_BRANDS.has(b.toString("latin1", 8, 12))
    );
  } finally {
    await fh.close();
  }
}
const heicToJpegBuffer = async (file, quality) =>
  Buffer.from(
    await require("heic-convert")({
      buffer: await fs.promises.readFile(file),
      format: "JPEG",
      quality: Math.max(0.3, Math.min(1, quality / 100)),
    }),
  );
const sharp = () => require("sharp");

const ops = {
  async imageToJpg({ input, output, quality = 92 }) {
    if (await isHeif(input)) {
      await fs.promises.writeFile(
        output,
        await heicToJpegBuffer(input, quality),
      );
      return output;
    }
    await sharp()(input, { failOn: "none" })
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toFile(output);
    return output;
  },
  async imagesToPdf({ inputs, output }) {
    const { PDFDocument } = require("pdf-lib");
    const pdf = await PDFDocument.create();
    for (const f of inputs) {
      let embed;
      const ext = path.extname(f).toLowerCase();
      try {
        if (await isHeif(f))
          embed = await pdf.embedJpg(await heicToJpegBuffer(f, 90));
        else if (ext === ".jpg" || ext === ".jpeg")
          embed = await pdf.embedJpg(await fs.promises.readFile(f));
        else
          embed = await pdf.embedPng(
            await sharp()(f, { failOn: "none" }).rotate().png().toBuffer(),
          );
      } catch {
        throw new Error(`Unsupported or damaged image: ${path.basename(f)}`);
      }
      pdf
        .addPage([embed.width, embed.height])
        .drawImage(embed, {
          x: 0,
          y: 0,
          width: embed.width,
          height: embed.height,
        });
    }
    await fs.promises.writeFile(output, await pdf.save());
    return output;
  },
  async thumbnail({ input, size = 200 }) {
    if (await isHeif(input)) return null; // vault thumbnails come from our own JPG outputs; skip rather than risk decoding a huge HEIC
    return (
      await sharp()(input, { failOn: "none" })
        .rotate()
        .resize(size, size, { fit: "cover" })
        .jpeg({ quality: 62 })
        .toBuffer()
    ).toString("base64");
  },
  async screenshot({ input, maxBytes = 550000 }) {
    const st = await fs.promises.stat(input);
    if (st.size > 40 * 1048576)
      throw new Error("That image is too large to attach.");
    for (const [width, quality] of [
      [1280, 72],
      [1100, 62],
      [900, 52],
      [700, 45],
    ]) {
      const buf = await sharp()(input, { failOn: "none" })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (buf.length <= maxBytes)
        return {
          dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
          bytes: buf.length,
        };
    }
    throw new Error(
      "Could not shrink that image enough. Try a smaller screenshot.",
    );
  },
};
if (process.env.MTP_TEST_OPS) {
  ops.crash = async () => process.abort();
  ops.hang = () => new Promise(() => {});
} // test-only: lets tests prove an abort or a hang cannot take the app down

// Map low-level library errors to one short, safe sentence (no paths, no stack traces).
const friendly = (e, args) => {
  const name = path.basename(
    (args && (args.input || (args.inputs && args.inputs[0]))) || "image",
  );
  if (e.code === "ENOENT") return `${name}: the file was not found.`;
  if (/^(That image|Could not shrink|Unsupported or damaged)/.test(e.message))
    return e.message;
  if (/heif|heic|libheif|decoding plugin|bad seek/i.test(e.message))
    return `${name}: this HEIC/HEIF file could not be read. It may be damaged or use an unsupported format.`;
  return `${name}: this image could not be read. It may be damaged or in an unsupported format.`;
};
process.on("message", async ({ op, args }) => {
  try {
    process.send({ ok: true, result: await ops[op](args) });
  } catch (e) {
    process.send({ ok: false, error: friendly(e, args) });
  }
  process.exit(0);
});
