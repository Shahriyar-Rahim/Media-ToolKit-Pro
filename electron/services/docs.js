const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const { callWorker } = require("./imageHost");

// Native image work (sharp, HEIC decoding) runs in a separate process: see imageWorker.js.
const heicToJpg = (input, output, quality = 92) =>
  callWorker("imageToJpg", { input, output, quality });
async function imagesToPdf(inputs, output) {
  if (!inputs.length) throw new Error("No images selected.");
  return callWorker("imagesToPdf", { inputs, output });
}

async function mergePdfs(inputs, output) {
  if (inputs.length < 2) throw new Error("Select at least two PDFs to merge.");
  const out = await PDFDocument.create();
  for (const f of inputs) {
    let src;
    try {
      src = await PDFDocument.load(await fs.promises.readFile(f));
    } catch {
      throw new Error(`Corrupt or encrypted PDF: ${path.basename(f)}`);
    }
    (await out.copyPages(src, src.getPageIndices())).forEach((p) =>
      out.addPage(p),
    );
  }
  await fs.promises.writeFile(output, await out.save());
}
module.exports = { heicToJpg, imagesToPdf, mergePdfs };
