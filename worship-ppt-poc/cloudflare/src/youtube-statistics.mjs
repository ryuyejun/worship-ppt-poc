// Store only the most recent public counts; this does not calculate rankings.
export async function refreshYoutubeStatistics(db, apiKey, fetcher = fetch) {
  if (!apiKey) throw new Error('YouTube API key is not configured');
  await db.prepare("DELETE FROM youtube_video_statistics WHERE datetime(fetched_at) < datetime('now', '-30 days')").run();
  const { results } = await db.prepare('SELECT video_id FROM youtube_videos WHERE enabled = 1 ORDER BY video_id').all();
  let updated = 0;
  for (let offset = 0; offset < results.length; offset += 50) {
    const ids = results.slice(offset, offset + 50).map(row => row.video_id);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', ids.join(','));
    const response = await fetcher(url, { headers: { 'x-goog-api-key': apiKey } });
    if (!response.ok) throw new Error(`YouTube statistics request failed (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload.items)) throw new Error('Invalid YouTube statistics response');
    const now = new Date().toISOString();
    for (const item of payload.items) {
      if (!ids.includes(item.id)) continue;
      const count = value => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
      await db.prepare(`INSERT INTO youtube_video_statistics (video_id, view_count, like_count, fetched_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET
        view_count = excluded.view_count, like_count = excluded.like_count, fetched_at = excluded.fetched_at`)
        .bind(item.id, count(item.statistics?.viewCount), count(item.statistics?.likeCount), now).run();
      updated++;
    }
  }
  return { requested: results.length, updated };
}
