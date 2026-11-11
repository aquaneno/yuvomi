import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Private module database; never opens or writes Yuvomi's database. */
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS timetables (
      user_id INTEGER PRIMARY KEY, data TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );`);
  return {
    get(userId) {
      const row = db.prepare('SELECT data, revision FROM timetables WHERE user_id = ?').get(userId);
      return row ? { data: JSON.parse(row.data), revision: row.revision } : null;
    },
    save(userId, data, revision) {
      // A conditional insert + update is one atomic SQLite operation, including first save.
      return db.prepare(`INSERT INTO timetables (user_id, data, revision)
        SELECT ?, ?, 1 WHERE ? = 0 OR EXISTS(SELECT 1 FROM timetables WHERE user_id = ?)
        ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, revision = timetables.revision + 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE timetables.revision = ? RETURNING revision`).get(userId, JSON.stringify(data), revision, userId, revision);
    },
    close() { db.close(); },
  };
}
