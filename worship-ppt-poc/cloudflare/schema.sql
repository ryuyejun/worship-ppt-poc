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
