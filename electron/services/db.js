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
      ratio REAL, success INTEGER NOT NULL, processing_ms INTEGER, settings TEXT, user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  // Upgrade from the single-user version: add the owner column to an existing table.
  if (!db.prepare('PRAGMA table_info(history)').all().some((c) => c.name === 'user_id')) db.exec('ALTER TABLE history ADD COLUMN user_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, created_at DESC)');
  const COLS = 'id, original_name, output_name, source_path, output_path, operation, media_type, created_at, duration_sec, input_size, output_size, ratio, success, processing_ms, settings, user_id';
  const get = (k, d) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? JSON.parse(r.value) : d; };
  const set = (k, v) => db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));
  // Every history read/write below requires the signed-in user's id. No id = no access (fails closed), so one account
  // on a shared computer can never see, open, thumbnail, delete or clear another account's records.
  return {
    addHistory(r) {
      db.prepare(`INSERT INTO history (${COLS}) VALUES (@id,@original_name,@output_name,@source_path,@output_path,@operation,@media_type,@created_at,@duration_sec,@input_size,@output_size,@ratio,@success,@processing_ms,@settings,@user_id)`).run({ user_id: null, ...r });
    },
    listHistory({ userId, search = '', mediaType = '', sort = 'new', limit = 100, offset = 0 } = {}) {
      if (!userId) return [];
      const order = { new: 'created_at DESC', old: 'created_at ASC', size: 'output_size DESC' }[sort] || 'created_at DESC';
      return db.prepare(`SELECT * FROM history WHERE user_id = @uid AND (COALESCE(original_name, '') LIKE @q OR COALESCE(output_name, '') LIKE @q)
        AND (@mt = '' OR media_type = @mt) ORDER BY ${order} LIMIT @limit OFFSET @offset`)
        .all({ uid: String(userId), q: `%${search}%`, mt: mediaType, limit, offset });
    },
    getHistoryRow(id, userId) { return userId ? db.prepare('SELECT * FROM history WHERE id = ? AND user_id = ?').get(id, String(userId)) : undefined; },
    deleteHistory(id, userId) { if (userId) db.prepare('DELETE FROM history WHERE id = ? AND user_id = ?').run(id, String(userId)); }, // the record only, never the file
    clearHistory(userId) { if (userId) db.prepare('DELETE FROM history WHERE user_id = ?').run(String(userId)); },
    // Records created before accounts were separated have no owner. The first account to open its Vault after the upgrade
    // takes them (on a one-person computer that is the right person); after that nobody can claim them.
    claimLegacy(userId) { if (userId && !get('legacyClaimed', false)) { db.prepare('UPDATE history SET user_id = ? WHERE user_id IS NULL').run(String(userId)); set('legacyClaimed', true); } },
    getSetting: get, setSetting: set,
  };
}
module.exports = { openDb };
