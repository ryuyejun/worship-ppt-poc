PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS songs (
 id INTEGER PRIMARY KEY, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
 lyricist TEXT, composer TEXT, artist TEXT, lyrics TEXT, source_url TEXT,
 version TEXT, lyrics_status TEXT, category TEXT, hymn_number INTEGER
);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(normalized_title);
CREATE INDEX IF NOT EXISTS idx_songs_hymn ON songs(hymn_number);
CREATE TABLE IF NOT EXISTS song_aliases (
 id INTEGER PRIMARY KEY, song_id INTEGER NOT NULL REFERENCES songs(id),
 alias TEXT NOT NULL, normalized_alias TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_song_aliases_name ON song_aliases(normalized_alias);
CREATE TABLE IF NOT EXISTS song_requests (
 id INTEGER PRIMARY KEY, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
 lyricist TEXT, normalized_lyricist TEXT, status TEXT, request_count INTEGER,
 created_at TEXT, updated_at TEXT, song_id INTEGER REFERENCES songs(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_song_requests_title_author ON song_requests(normalized_title, normalized_lyricist);
CREATE TABLE IF NOT EXISTS auth_users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 refresh_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 last_used_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
