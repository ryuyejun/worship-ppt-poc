CREATE TABLE IF NOT EXISTS youtube_channels (
  channel_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE youtube_videos ADD COLUMN video_title TEXT;
ALTER TABLE youtube_videos ADD COLUMN channel_id TEXT;
