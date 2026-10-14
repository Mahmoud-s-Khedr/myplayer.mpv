import Database from 'better-sqlite3'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE tracks (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '',
    duration_sec REAL,
    thumbnail TEXT,
    url TEXT,
    local_path TEXT,
    license TEXT,
    download_policy TEXT NOT NULL DEFAULT 'unknown',
    policy_reason TEXT,
    qualified_plays INTEGER NOT NULL DEFAULT 0,
    favorited_at INTEGER,
    last_played_at INTEGER,
    added_at INTEGER NOT NULL
  );
  CREATE TABLE plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    listened_ms INTEGER NOT NULL DEFAULT 0,
    qualified INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX plays_started ON plays(started_at DESC);
  CREATE TABLE playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE playlist_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX playlist_entries_pl ON playlist_entries(playlist_id, position);
  CREATE TABLE cache_entries (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    thumb_file TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // Lets a track link back to its channel.
  `ALTER TABLE tracks ADD COLUMN channel_id TEXT;`
]

/** Open (or create) the database and bring its schema up to date. Pass ':memory:' in tests. */
export function openDatabase(file: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}
