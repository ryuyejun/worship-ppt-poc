import { listSongs, searchSongs, getSong, queueMissing } from './songs.mjs';
import { findArtwork, getArtworkImage } from './artwork.mjs';
import { refreshYoutubeStatistics } from './youtube-statistics.mjs';
import { matchSongVideos } from './song-video-match.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status) => json({ success: false, data: null, error: message }, status);
const ok = data => json({ success: true, data, error: null });
const routes = new Set(['/songs', '/ppt-songs', '/search', '/song', '/requests', '/providers/search', '/song-artwork/search', '/youtube-videos']);

async function readInput(request) {
  if (Number(request.headers.get('content-length') || 0) > 4096) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshYoutubeStatistics(env.DB, env.YOUTUBE_API_KEY));
  },
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
      try { await env.DB.prepare('SELECT 1 AS ok').first(); return json({ status: 'ok', database: 'connected' }); }
      catch { return json({ status: 'unavailable', database: 'unavailable' }, 503); }
    }
    const imageMatch = path.match(/^\/song-artwork\/image\/(-?\d+)$/);
    if (imageMatch && request.method === 'GET') {
      try {
        const image = await getArtworkImage(env.DB, Number(imageMatch[1]));
        return image ? new Response(image.bytes, { headers: { 'Content-Type': image.type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404 });
      } catch { return new Response(null, { status: 500 }); }
    }
    if (!routes.has(path)) {
      if (path === '/batch-import' || path === '/requests/complete') return fail('웹에서 곡을 변경하는 기능은 아직 사용할 수 없습니다.', 403);
      if (env.ASSETS && request.method === 'GET') return env.ASSETS.fetch(request);
      return fail('지원하지 않는 기능입니다.', 404);
    }
    if (request.method !== 'POST') return fail('지원하지 않는 요청입니다.', 405);
    try {
      if (env.API_LIMIT && !(await env.API_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' })).success) return fail('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429);
      const text = await readInput(request);
      if (text === null) return fail('요청이 너무 큽니다.', 413);
      let input;
      try { input = text ? JSON.parse(text) : {}; } catch { return fail('요청 형식을 확인해 주세요.', 400); }
      if (path === '/songs') return ok(await listSongs(env.DB, false));
      if (path === '/youtube-videos') {
        const { results } = await env.DB.prepare(`SELECT v.video_id AS videoId, v.video_title AS videoTitle, s.view_count AS views, s.like_count AS likes, s.fetched_at AS fetchedAt
          FROM youtube_videos v JOIN youtube_video_statistics s ON s.video_id = v.video_id
          WHERE v.enabled = 1 AND v.video_title IS NOT NULL AND datetime(s.fetched_at) >= datetime('now', '-30 days')
          ORDER BY v.rowid DESC LIMIT 1000`).all();
        const songs = await env.DB.prepare('SELECT id, title FROM songs WHERE title IS NOT NULL').all();
        return ok(matchSongVideos(results, songs.results));
      }
      if (path === '/ppt-songs') return ok(await listSongs(env.DB, true));
      if (path === '/search') {
        const songs = await searchSongs(env.DB, input?.title);
        if (!songs.length) {
          if (env.REQUEST_LIMIT && !(await env.REQUEST_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' })).success) return fail('추가 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429);
          const count = await queueMissing(env.DB, input.title);
          const response = ok(songs);
          response.headers.set('X-Request-Count', String(count));
          return response;
        }
        return ok(songs);
      }
      if (path === '/song') {
        if (!Number.isSafeInteger(input?.id) || input.id < 1) return fail('곡 번호를 확인해 주세요.', 400);
        const song = await getSong(env.DB, input.id);
        return song ? ok(song) : fail('가사가 저장된 곡을 찾을 수 없습니다.', 404);
      }
      if (path === '/requests') {
        const query = typeof input?.query === 'string' ? input.query.trim().slice(0, 255) : '';
        const { results } = await env.DB.prepare("SELECT id, title, lyricist, request_count AS count FROM song_requests WHERE status = 'PENDING' AND (title LIKE ? OR lyricist LIKE ?) ORDER BY updated_at DESC LIMIT 100")
          .bind(`%${query}%`, `%${query}%`).all();
        return ok(results);
      }
      if (path === '/providers/search') return ok({ candidates: [], status: ['추가 제공처는 아직 연결되지 않았습니다'] });
      return ok(await findArtwork(env.DB, input?.songId, env.PIXABAY_API_KEY, input?.title));
    } catch (error) {
      if (error instanceof TypeError) return fail('곡 제목을 확인해 주세요.', 400);
      return fail('곡 조회 중 오류가 발생했습니다.', 500);
    }
  },
};
