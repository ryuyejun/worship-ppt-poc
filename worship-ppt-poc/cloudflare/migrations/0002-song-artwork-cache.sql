CREATE TABLE IF NOT EXISTS song_artwork_cache (
  song_id INTEGER PRIMARY KEY REFERENCES songs(id),
  song_title TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  search_response TEXT NOT NULL,
  image_data BLOB,
  image_type TEXT,
  source_url TEXT,
  contributor TEXT
);
