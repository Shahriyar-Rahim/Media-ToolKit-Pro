const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
let openDb = null;
try {
  openDb = require("../services/db").openDb;
  const t = new (require("better-sqlite3"))(":memory:");
  t.close();
} catch {
  openDb = null;
} // skipped when the native module is built for Electron instead of Node
const skip =
  !openDb &&
  "better-sqlite3 is not built for this Node (it is built for Electron)";
const row = (o = {}) => ({
  id: `id${Math.random()}`,
  original_name: "a.mp4",
  output_name: "a_compressed.mp4",
  source_path: "/s/a.mp4",
  output_path: "/o/a_compressed.mp4",
  operation: "video",
  media_type: "video",
  created_at: Date.now(),
  duration_sec: 2,
  input_size: 1000,
  output_size: 400,
  ratio: 0.4,
  success: 1,
  processing_ms: 1500,
  settings: "{}",
  ...o,
});

test(
  "VAULT history: add, search, filter, sort, delete one, clear — never touches the media file",
  { skip },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtp-db-"));
    const db = openDb(dir);
    const real = path.join(dir, "keep.mp4");
    fs.writeFileSync(real, "media");
    const a = row({
        id: "a",
        original_name: "holiday.mp4",
        output_path: real,
        created_at: 1000,
        output_size: 100,
      }),
      b = row({
        id: "b",
        original_name: "song.mp3",
        operation: "audio",
        media_type: "audio",
        created_at: 2000,
        output_size: 900,
      }),
      c = row({
        id: "c",
        original_name: "broken.mov",
        success: 0,
        output_path: null,
        created_at: 3000,
        output_size: null,
      });
    [a, b, c].forEach((r) => db.addHistory(r));
    assert.deepStrictEqual(
      db.listHistory().map((r) => r.id),
      ["c", "b", "a"],
    );
    assert.deepStrictEqual(
      db.listHistory({ sort: "old" }).map((r) => r.id),
      ["a", "b", "c"],
    );
    assert.deepStrictEqual(
      db.listHistory({ search: "song" }).map((r) => r.id),
      ["b"],
    );
    assert.deepStrictEqual(
      db.listHistory({ mediaType: "audio" }).map((r) => r.id),
      ["b"],
    );
    assert.strictEqual(db.listHistory({ sort: "size" })[0].id, "b");
    assert.strictEqual(db.getHistoryRow("c").success, 0);
    assert.strictEqual(db.getHistoryRow("nope"), undefined);
    db.deleteHistory("a");
    assert.ok(
      fs.existsSync(real),
      "record deletion must not delete the user file",
    );
    assert.strictEqual(db.listHistory().length, 2);
    db.clearHistory();
    assert.strictEqual(db.listHistory().length, 0);
    assert.ok(fs.existsSync(real));
  },
);
test("VAULT search text is a value, not SQL", { skip }, () => {
  const db = openDb(fs.mkdtempSync(path.join(os.tmpdir(), "mtp-db-")));
  db.addHistory(row({ id: "x" }));
  assert.strictEqual(
    db.listHistory({ search: "'; DROP TABLE history; --" }).length,
    0,
  );
  assert.strictEqual(db.listHistory().length, 1);
});
test(
  "SETTINGS persist across reopen with defaults for missing keys",
  { skip },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtp-db-"));
    let db = openDb(dir);
    assert.deepStrictEqual(db.getSetting("app", { a: 1 }), { a: 1 });
    db.setSetting("app", { outputMode: "custom", outputDir: "/x" });
    db = openDb(dir);
    assert.deepStrictEqual(db.getSetting("app", {}), {
      outputMode: "custom",
      outputDir: "/x",
    });
  },
);
