const Database = require('better-sqlite3');
const path = require('path');

function openDb(dir) {
  const db = new Database(path.join(dir, 'mediatoolkit.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      original_name TEXT, output_name TEXT, source_path TEXT, output_path TEXT,
      operation TEXT NOT NULL, media_type TEXT, created_at INTEGER NOT NULL,
      duration_sec REAL, input_size INTEGER, output_size INTEGER,
      ratio REAL, success INTEGER NOT NULL, processing_ms INTEGER, settings TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return {
    addHistory(r) {
      db.prepare(`INSERT INTO history VALUES (@id,@original_name,@output_name,@source_path,@output_path,
        @operation,@media_type,@created_at,@duration_sec,@input_size,@output_size,@ratio,@success,@processing_ms,@settings)`).run(r);
    },
    listHistory({ search = '', mediaType = '', sort = 'new', limit = 100, offset = 0 } = {}) {
      const order = { new: 'created_at DESC', old: 'created_at ASC', size: 'output_size DESC' }[sort] || 'created_at DESC';
      return db.prepare(`SELECT * FROM history WHERE (original_name LIKE @q OR output_name LIKE @q)
        AND (@mt = '' OR media_type = @mt) ORDER BY ${order} LIMIT @limit OFFSET @offset`)
        .all({ q: `%${search}%`, mt: mediaType, limit, offset });
    },
    getHistoryRow(id) { return db.prepare('SELECT * FROM history WHERE id = ?').get(id); },
    deleteHistory(id) { db.prepare('DELETE FROM history WHERE id = ?').run(id); }, // record only, never the file
    clearHistory() { db.prepare('DELETE FROM history').run(); },
    getSetting(k, d) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? JSON.parse(r.value) : d; },
    setSetting(k, v) { db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v)); },
  };
}
module.exports = { openDb };
