// Preserve the actual video title, including medleys and full services.
async function youtubeGet(path, params, apiKey, fetcher) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetcher(url, { headers: { 'x-goog-api-key': apiKey } });
  if (!response.ok) throw new Error(`YouTube request failed (${response.status})`);
  const payload = await response.json();
  if (!Array.isArray(payload.items)) throw new Error('Invalid YouTube response');
  return { items: payload.items, nextPageToken: payload.nextPageToken };
}

export async function discoverChannelVideos(db, apiKey, fetcher = fetch) {
  const { results: channels } = await db.prepare('SELECT channel_id FROM youtube_channels WHERE enabled = 1 ORDER BY channel_id').all();
  for (let offset = 0; offset < channels.length; offset += 50) {
    const ids = channels.slice(offset, offset + 50).map(row => row.channel_id);
    const { items } = await youtubeGet('channels', { part: 'contentDetails', id: ids.join(',') }, apiKey, fetcher);
    for (const channel of items) {
      if (!ids.includes(channel.id)) continue;
      const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
      if (!playlistId) continue;
      const firstPage = await youtubeGet('playlistItems', { part: 'snippet', playlistId, maxResults: '50' }, apiKey, fetcher);
      const videos = [...firstPage.items];
      if (firstPage.nextPageToken) {
        const secondPage = await youtubeGet('playlistItems', { part: 'snippet', playlistId, maxResults: '50', pageToken: firstPage.nextPageToken }, apiKey, fetcher);
        videos.push(...secondPage.items);
      }
      const statements = [];
      for (const video of videos) {
        const videoId = video.snippet?.resourceId?.videoId;
        const title = video.snippet?.title;
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '') || typeof title !== 'string') continue;
        statements.push(db.prepare(`INSERT INTO youtube_videos (video_id, channel_id, video_title) VALUES (?, ?, ?)
          ON CONFLICT(video_id) DO UPDATE SET channel_id = excluded.channel_id, video_title = excluded.video_title`)
          .bind(videoId, channel.id, title));
      }
      if (statements.length) await db.batch(statements);
    }
  }
}

// Store only the most recent public counts; this does not calculate rankings.
export async function refreshYoutubeStatistics(db, apiKey, fetcher = fetch) {
  if (!apiKey) throw new Error('YouTube API key is not configured');
  await db.prepare("UPDATE youtube_videos SET video_title = NULL WHERE video_id IN (SELECT video_id FROM youtube_video_statistics WHERE datetime(fetched_at) < datetime('now', '-30 days'))").run();
  await db.prepare("DELETE FROM youtube_video_statistics WHERE datetime(fetched_at) < datetime('now', '-30 days')").run();
  await discoverChannelVideos(db, apiKey, fetcher);
  const { results } = await db.prepare('SELECT video_id FROM youtube_videos WHERE enabled = 1 ORDER BY video_id').all();
  let updated = 0;
  for (let offset = 0; offset < results.length; offset += 50) {
    const ids = results.slice(offset, offset + 50).map(row => row.video_id);
    const { items } = await youtubeGet('videos', { part: 'snippet,statistics', id: ids.join(',') }, apiKey, fetcher);
    const now = new Date().toISOString();
    const statements = [];
    for (const item of items) {
      if (!ids.includes(item.id)) continue;
      if (typeof item.snippet?.title === 'string') {
        statements.push(db.prepare('UPDATE youtube_videos SET video_title = ? WHERE video_id = ?').bind(item.snippet.title, item.id));
      }
      const count = value => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
      statements.push(db.prepare(`INSERT INTO youtube_video_statistics (video_id, view_count, like_count, fetched_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET
        view_count = excluded.view_count, like_count = excluded.like_count, fetched_at = excluded.fetched_at`)
        .bind(item.id, count(item.statistics?.viewCount), count(item.statistics?.likeCount), now));
      updated++;
    }
    if (statements.length) await db.batch(statements);
  }
  return { requested: results.length, updated };
}
