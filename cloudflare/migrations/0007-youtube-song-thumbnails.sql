CREATE TABLE IF NOT EXISTS youtube_song_thumbnails (
  song_id INTEGER PRIMARY KEY REFERENCES songs(id),
  song_title TEXT NOT NULL,
  video_id TEXT,
  fetched_at TEXT NOT NULL
);
