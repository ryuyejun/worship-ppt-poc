import { listSongs, searchSongs, getSong, queueMissing } from './songs.mjs';
import { findArtwork, getArtworkImage } from './artwork.mjs';
import { refreshYoutubeStatistics } from './youtube-statistics.mjs';
import { matchSongVideos } from './song-video-match.mjs';
import { handleAuthRequest, verifyAccessCookie } from './auth.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status) => json({ success: false, data: null, error: message }, status);
const ok = data => json({ success: true, data, error: null });
const routes = new Set(['/songs', '/ppt-songs', '/search', '/song', '/requests', '/song-artwork/search', '/youtube-videos', '/youtube-thumbnail/search']);

async function getTrendingSongs(db) {
  const { results: videos } = await db.prepare(`SELECT v.video_id AS videoId, v.video_title AS videoTitle, s.view_count AS views, s.like_count AS likes, s.fetched_at AS fetchedAt
    FROM youtube_videos v JOIN youtube_video_statistics s ON s.video_id = v.video_id
    WHERE v.enabled = 1 AND v.video_title IS NOT NULL AND datetime(s.fetched_at) >= datetime('now', '-30 days')
    ORDER BY v.rowid DESC LIMIT 1000`).all();
  const { results: songs } = await db.prepare('SELECT id, title FROM songs WHERE title IS NOT NULL').all();
  const matches = matchSongVideos(videos, songs);
  const { results: artworkRows } = await db.prepare('SELECT song_id AS songId FROM song_artwork_cache WHERE image_data IS NOT NULL ORDER BY song_id').all();
  if (!artworkRows.length) return matches.map(song => ({ ...song, artworkUrl: null }));
  const artworkIds = artworkRows.map(row => row.songId);
  const artworkIdSet = new Set(artworkIds);
  return matches.map(song => {
    const imageId = artworkIdSet.has(song.songId) ? song.songId : artworkIds[Math.abs(song.songId) % artworkIds.length];
    return { ...song, artworkUrl: `/song-artwork/image/${imageId}` };
  });
}

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
    ctx.waitUntil((async () => {
      await refreshYoutubeStatistics(env.DB, env.YOUTUBE_API_KEY);
      const songs = await getTrendingSongs(env.DB);
      for (let index = 0; index < songs.length; index += 3) {
        await Promise.allSettled(songs.slice(index, index + 3).map(song => findArtwork(env.DB, song.songId, env.PIXABAY_API_KEY, song.title)));
      }
    })());
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const melodyJobPath = /^\/api\/auto-melody\/jobs\/[a-f0-9]{32}$/.test(path);
    const melodySubmit = path === '/api/auto-melody/jobs';
    if (melodySubmit || melodyJobPath) {
      const methods = melodySubmit ? ['POST'] : ['GET'];
      if (!methods.includes(request.method)) return fail('지원하지 않는 요청입니다.', 405);
      const title = url.searchParams.get('title')?.trim();
      const artist = url.searchParams.get('artist')?.trim() ?? '';
      if (!melodyJobPath && (!title || title.length > 120 || artist.length > 120)) return fail('곡 제목을 확인해 주세요.', 400);
      if (!env.AUTO_MELODY_ORIGIN || !env.AUTO_MELODY_TOKEN) return fail('이 배포에 악보 PPT 변환 서버가 아직 연결되지 않았습니다.', 503);
      try {
        const user = await verifyAccessCookie(request, env);
        if (!user) return fail('로그인이 필요합니다.', 401);
        const limitKey = melodyJobPath && request.method === 'GET'
          ? `melody-status:${user.id}` : request.headers.get('CF-Connecting-IP') || 'unknown';
        if (env.API_LIMIT && !(await env.API_LIMIT.limit({ key: limitKey })).success) {
          return fail('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429);
        }
        const upstream = new URL(path, env.AUTO_MELODY_ORIGIN);
        if (title) upstream.searchParams.set('title', title);
        if (artist) upstream.searchParams.set('artist', artist);
        const response = await fetch(upstream, {
          method: request.method,
          headers: { Authorization: `Bearer ${env.AUTO_MELODY_TOKEN}` },
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        });
        return new Response(response.body, {
          status: response.status,
          headers: {
            'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            ...(response.headers.has('Retry-After') ? { 'Retry-After': response.headers.get('Retry-After') } : {}),
          },
        });
      } catch {
        return fail('멜로디 분석을 사용할 수 없습니다.', 502);
      }
    }
    if (path === '/health' && request.method === 'GET') {
      try { await env.DB.prepare('SELECT 1 AS ok').first(); return json({ status: 'ok', database: 'connected' }); }
      catch { return json({ status: 'unavailable', database: 'unavailable' }, 503); }
    }
    const youtubeThumbnailMatch = path.match(/^\/youtube-thumbnail\/([A-Za-z0-9_-]{11})$/);
    if (youtubeThumbnailMatch && request.method === 'GET') {
      try {
        const response = await fetch(`https://i.ytimg.com/vi/${youtubeThumbnailMatch[1]}/hqdefault.jpg`, { signal: AbortSignal.timeout(8000) });
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.startsWith('image/')) return new Response(null, { status: 404 });
        return new Response(response.body, { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response(null, { status: 502 }); }
    }
    const imageMatch = path.match(/^\/song-artwork\/image\/(-?\d+)$/);
    if (imageMatch && request.method === 'GET') {
      try {
        const image = await getArtworkImage(env.DB, Number(imageMatch[1]));
        return image ? new Response(image.bytes, { headers: { 'Content-Type': image.type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404 });
      } catch { return new Response(null, { status: 500 }); }
    }
    if (path.startsWith('/auth/')) {
      if (path !== '/auth/me' && env.AUTH_LIMIT && !(await env.AUTH_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' })).success) return fail('인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429);
      try { return await handleAuthRequest(request, env, path); }
      catch (error) {
        console.error('Authentication request failed', { path, error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error' });
        return fail('인증 요청을 처리하지 못했습니다.', 500);
      }
    }
    if (!routes.has(path)) {
      if (env.ASSETS && request.method === 'GET') return env.ASSETS.fetch(request);
      return fail('지원하지 않는 기능입니다.', 404);
    }
    if (request.method !== 'POST') return fail('지원하지 않는 요청입니다.', 405);
    try {
      const user = await verifyAccessCookie(request, env);
      if (!user) return fail('로그인이 필요합니다.', 401);
      if (env.API_LIMIT && !(await env.API_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' })).success) return fail('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429);
      const text = await readInput(request);
      if (text === null) return fail('요청이 너무 큽니다.', 413);
      let input;
      try { input = text ? JSON.parse(text) : {}; } catch { return fail('요청 형식을 확인해 주세요.', 400); }
      if (path === '/songs') return ok(await listSongs(env.DB, false));
      if (path === '/youtube-videos') return ok(await getTrendingSongs(env.DB));
      if (path === '/youtube-thumbnail/search') {
        const songId = input?.songId;
        const title = typeof input?.title === 'string' ? input.title.normalize('NFC').trim().slice(0, 100) : '';
        if (!Number.isSafeInteger(songId) || songId === 0 || !title) return fail('곡 정보를 확인해 주세요.', 400);
        const cached = songId > 0 ? await env.DB.prepare('SELECT song_title AS title, video_id AS videoId, fetched_at AS fetchedAt FROM youtube_song_thumbnails WHERE song_id = ?').bind(songId).first() : null;
        if (cached?.videoId && cached.title === title && Date.now() - Date.parse(cached.fetchedAt) < 7 * 24 * 60 * 60 * 1000) {
          return ok({ videoId: cached.videoId, imageUrl: cached.videoId ? `/youtube-thumbnail/${cached.videoId}` : null });
        }
        if (!env.YOUTUBE_API_KEY) return ok({ videoId: null, imageUrl: null });
        const search = new URL('https://www.googleapis.com/youtube/v3/search');
        const artist = typeof input?.artist === 'string' && !/^(미확인|정보 없음|unknown)$/i.test(input.artist.trim()) ? input.artist.trim().slice(0, 100) : '';
        const searchTitle = title.replace(/\s*\((?:feat\.?|ft\.?|prod\.?)[^)]*\)/ig, '').trim();
        const koreanTitle = Array.from(searchTitle.matchAll(/\(([^)]+)\)/g), match => match[1]).find(value => /[가-힣]/.test(value));
        search.search = new URLSearchParams({ part: 'snippet', q: `${artist} ${koreanTitle || searchTitle}`.trim(), type: 'video', maxResults: '10', relevanceLanguage: 'ko', regionCode: 'KR', key: env.YOUTUBE_API_KEY }).toString();
        const found = await fetch(search, { signal: AbortSignal.timeout(8000) });
        if (!found.ok) return ok({ videoId: null, imageUrl: null });
        const payload = await found.json();
        const normalize = value => String(value || '').normalize('NFC').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]/gu, '');
        const variants = [searchTitle, ...Array.from(searchTitle.matchAll(/\(([^)]+)\)/g), match => match[1]), searchTitle.replace(/\([^)]*\)/g, '').trim()]
          .map(normalize).filter(value => value.length >= 2);
        const candidate = (Array.isArray(payload.items) ? payload.items : []).find(item => {
          const candidateTitle = normalize(item?.snippet?.title);
          return variants.some(wanted => candidateTitle.includes(wanted));
        });
        const videoId = /^[A-Za-z0-9_-]{11}$/.test(candidate?.id?.videoId || '') ? candidate.id.videoId : null;
        if (songId > 0) await env.DB.prepare(`INSERT INTO youtube_song_thumbnails(song_id,song_title,video_id,fetched_at) VALUES(?,?,?,?)
          ON CONFLICT(song_id) DO UPDATE SET song_title=excluded.song_title,video_id=excluded.video_id,fetched_at=excluded.fetched_at`)
          .bind(songId, title, videoId, new Date().toISOString()).run();
        return ok({ videoId, imageUrl: videoId ? `/youtube-thumbnail/${videoId}` : null });
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
      return ok(await findArtwork(env.DB, input?.songId, env.PIXABAY_API_KEY, input?.title));
    } catch (error) {
      if (error instanceof TypeError) return fail('곡 제목을 확인해 주세요.', 400);
      return fail('곡 조회 중 오류가 발생했습니다.', 500);
    }
  },
};
