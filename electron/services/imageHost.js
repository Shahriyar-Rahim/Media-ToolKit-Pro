const { fork } = require("child_process");
const path = require("path");
const WORKER = path.join(__dirname, "imageWorker.js");
let logger = null;
// One short-lived worker process per call: a crash, abort or hang is contained and reported as an ordinary job failure.
function callWorker(op, args, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false,
      stderr = "";
    let child;
    try {
      child = fork(WORKER, [], {
        execPath: process.execPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
    } catch (e) {
      return reject(new Error("Could not start image processing."));
    }
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      fn(v);
    };
    const timer = setTimeout(
      () =>
        finish(
          reject,
          new Error("Image processing took too long and was stopped."),
        ),
      timeoutMs,
    );
    child.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-2000);
    });
    child.on("message", (m) =>
      m.ok ? finish(resolve, m.result) : finish(reject, new Error(m.error)),
    );
    child.on("error", () =>
      finish(reject, new Error("Could not start image processing.")),
    );
    child.on("exit", (code, signal) => {
      if (!done) {
        if (logger)
          logger.app("error", "image worker died", {
            op,
            code,
            signal,
            stderr,
          });
        finish(
          reject,
          new Error(
            "This image could not be processed. The file may be damaged or in an unsupported format.",
          ),
        );
      }
    });
    child.send({ op, args });
  });
}
module.exports = {
  callWorker,
  setLogger: (l) => {
    logger = l;
  },
};
