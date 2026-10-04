const fs = require('fs');
const sharp = require('sharp');

// Bug-report screenshot: any image the user picks is re-encoded to a small JPEG, so size and type are guaranteed.
async function prepareScreenshot(file, maxBytes = 550000) {
  const st = await fs.promises.stat(file); if (st.size > 40 * 1048576) throw new Error('That image is too large to attach.');
  for (const [width, quality] of [[1280, 72], [1100, 62], [900, 52], [700, 45]]) {
    const buf = await sharp(file, { failOn: 'none' }).rotate().resize({ width, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (buf.length <= maxBytes) return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, bytes: buf.length };
  }
  throw new Error('Could not shrink that image enough. Try a smaller screenshot.');
}
module.exports = { prepareScreenshot };
