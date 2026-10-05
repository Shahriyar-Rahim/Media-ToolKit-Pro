const { callWorker } = require("./imageHost");
// Bug-report screenshot: any image the user picks is re-encoded to a small JPEG (in the image worker process).
const prepareScreenshot = (file, maxBytes = 550000) =>
  callWorker("screenshot", { input: file, maxBytes });
module.exports = { prepareScreenshot };
