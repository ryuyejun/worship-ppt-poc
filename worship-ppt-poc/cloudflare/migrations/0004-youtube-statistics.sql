CREATE TABLE IF NOT EXISTS youtube_videos (
  video_id TEXT PRIMARY KEY,
  song_id INTEGER REFERENCES songs(id),
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS youtube_video_statistics (
  video_id TEXT PRIMARY KEY REFERENCES youtube_videos(video_id),
  view_count INTEGER,
  like_count INTEGER,
  fetched_at TEXT NOT NULL
);
