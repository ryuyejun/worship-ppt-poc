CREATE TABLE IF NOT EXISTS external_song_artwork_cache (
  song_id INTEGER PRIMARY KEY CHECK (song_id < 0),
  song_title TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  search_response TEXT NOT NULL,
  image_data BLOB,
  image_type TEXT,
  source_url TEXT,
  contributor TEXT
);
