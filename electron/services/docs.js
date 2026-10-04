const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

async function heicToJpg(input, output, quality = 92) {
  try { await sharp(input).jpeg({ quality }).toFile(output); return; } catch { /* fall through */ }
  const convert = require('heic-convert');
  const buf = await convert({ buffer: await fs.promises.readFile(input), format: 'JPEG', quality: quality / 100 });
  await fs.promises.writeFile(output, buf);
}

async function imagesToPdf(inputs, output) {
  if (!inputs.length) throw new Error('No images selected.');
  const pdf = await PDFDocument.create();
  for (const f of inputs) {
    let bytes, embed;
    try {
      const ext = path.extname(f).toLowerCase();
      if (ext === '.jpg' || ext === '.jpeg') { bytes = await fs.promises.readFile(f); embed = await pdf.embedJpg(bytes); }
      else { bytes = await sharp(f).png().toBuffer(); embed = await pdf.embedPng(bytes); }
    } catch { throw new Error(`Unsupported or corrupt image: ${path.basename(f)}`); }
    const page = pdf.addPage([embed.width, embed.height]);
    page.drawImage(embed, { x: 0, y: 0, width: embed.width, height: embed.height });
  }
  await fs.promises.writeFile(output, await pdf.save());
}

async function mergePdfs(inputs, output) {
  if (inputs.length < 2) throw new Error('Select at least two PDFs to merge.');
  const out = await PDFDocument.create();
  for (const f of inputs) {
    let src;
    try { src = await PDFDocument.load(await fs.promises.readFile(f)); }
    catch { throw new Error(`Corrupt or encrypted PDF: ${path.basename(f)}`); }
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  }
  await fs.promises.writeFile(output, await out.save());
}
module.exports = { heicToJpg, imagesToPdf, mergePdfs };
