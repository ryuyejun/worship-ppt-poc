import { listSongs, searchSongs, getSong, queueMissing } from './songs.mjs';
import { findArtwork, getArtworkImage } from './artwork.mjs';
import { refreshYoutubeStatistics } from './youtube-statistics.mjs';
import { matchSongVideos } from './song-video-match.mjs';
import { handleAuthRequest, verifyAccessCookie } from './auth.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status) => json({ success: false, data: null, error: message }, status);
const ok = data => json({ success: true, data, error: null });
const routes = new Set(['/songs', '/ppt-songs', '/search', '/song', '/song-lyrics', '/requests', '/providers/search', '/song-artwork/search', '/youtube-videos', '/youtube-thumbnail/search']);

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

function extractLyrics(description) {
  const metadata = /https?:\/\/|www\.|#\S+|\bfeat\.?|\bft\.?|구독|subscribe|instagram|facebook|twitter|문의|비즈니스|저작권|copyright|작사|작곡|편곡|제공|출처|후원|donat|contact|credit|written\s+by|words\s*(?:and|&)\s*music\s*by|앨범 소개|수록곡|lyrics by|music by|guitar|bass|drum|cello|videographer|photograph|color.?graded|video.?edit|engineer|lighting|vocal|mixed|mastered|arrange|location|special thanks|recorded|camera|director|producer|production|피아워십|워십팀|세션|촬영|편집|녹화|음향|조명|마스터링|믹싱|연주|출연|음악\s*자막\s*제작|자막\s*제작|본\s*영상은|수익\s*창출|수익\s*기능|사용하지\s*않았|수익을\s*창출|본\s*영상|영상\s*제작|이용해\s*주셔서|시청해\s*주셔서/i;
  const lyricHeading = /^\s*(?:[-*_=#> ]*)?(?:lyrics?|가사)(?:\s*(?:\/|·|:|：|-|–)\s*(?:가사|lyrics?))?\s*[:：]?\s*[-*_=# ]*$/i;
  const blocks = [];
  let current = [];
  let hasLyricsHeading = false;
  for (const rawLine of String(description || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/^\[\d{2}:\d{2}(?:\.\d+)?\]\s*/, '').trim();
    if (!line) {
      if (current.length && current[current.length - 1] !== '') current.push('');
      continue;
    }
    const inlineHeading = line.match(/^\s*(?:lyrics?|가사)\s*[:：]\s*(\S.*)$/i);
    if (lyricHeading.test(line) || inlineHeading) {
      current = [];
      blocks.length = 0;
      hasLyricsHeading = true;
      if (inlineHeading) current.push(inlineHeading[1].trim());
      continue;
    }
    if (metadata.test(line) || !/[가-힣A-Za-z]/.test(line)) {
      if (current.length) blocks.push(current);
      current = [];
      if (hasLyricsHeading && metadata.test(line)) break;
      continue;
    }
    if (line.length > 30 && /[.!?…][\"'”’)]?$/.test(line)) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    if (line.length > 110) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  const score = block => {
    const lines = block.filter(Boolean);
    if (!lines.length) return -Infinity;
    const hangulLines = lines.filter(line => /[가-힣]/.test(line)).length;
    const proseLines = lines.filter(line => line.length > 35 && /[.!?…]["'”’)]?$/.test(line)).length;
    const longLines = lines.filter(line => line.length > 90).length;
    const avgWords = lines.reduce((sum, line) => sum + line.split(/\s+/).length, 0) / lines.length;
    return lines.length + hangulLines * 1.5 - proseLines * 3 - longLines * 3 - Math.max(0, avgWords - 9) * 0.5;
  };
  const best = blocks.sort((left, right) => score(right) - score(left))[0] || [];
  const lyrics = best.filter(Boolean).join('\n').trim();
  const lines = lyrics.split('\n').map(line => line.trim()).filter(Boolean);
  const textLength = (lyrics.match(/[가-힣A-Za-z]/g) || []).length;
  return lines.length >= 5 && textLength >= 40 ? lyrics : '';
}

async function searchYouTubeLyrics(title, apiKey) {
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.search = new URLSearchParams({
    part: 'snippet', q: `${title} 가사`, type: 'video', maxResults: '10',
    relevanceLanguage: 'ko', regionCode: 'KR', key: apiKey,
  }).toString();
  const searchResponse = await fetch(searchUrl, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!searchResponse.ok) throw new Error('YouTube search failed');
  const searchPayload = await searchResponse.json();
  const candidates = (Array.isArray(searchPayload.items) ? searchPayload.items : []).flatMap(item => {
    const videoId = item?.id?.videoId;
    const snippet = item?.snippet;
    if (!videoId || !snippet?.title) return [];
    return [{ title: snippet.title, artist: snippet.channelTitle || '', source: 'YouTube', videoId,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, description: '', lyrics: '' }];
  });
  if (!candidates.length) return candidates;

  const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  videosUrl.search = new URLSearchParams({ part: 'snippet', id: candidates.map(item => item.videoId).join(','), key: apiKey }).toString();
  const videosResponse = await fetch(videosUrl, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!videosResponse.ok) throw new Error('YouTube videos lookup failed');
  const videosPayload = await videosResponse.json();
  const details = new Map((Array.isArray(videosPayload.items) ? videosPayload.items : []).map(item => [item.id, item?.snippet?.description || '']));
  return candidates.map(candidate => {
    const description = details.get(candidate.videoId) || '';
    return { ...candidate, lyrics: extractLyrics(description) };
  });
}

function normalizeSongText(value) {
  return String(value || '').normalize('NFC').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]/gu, '');
}

function songTitleScore(requestedTitle, candidateTitle) {
  const requested = normalizeSongText(requestedTitle);
  const candidate = normalizeSongText(candidateTitle);
  if (!requested || !candidate) return 0;
  if (requested.includes(candidate) || candidate.includes(requested)) return 1;
  const tokens = requestedTitle.split(/\s+/u).map(normalizeSongText).filter(token => token.length > 1);
  return tokens.length ? tokens.filter(token => candidate.includes(token)).length / tokens.length : 0;
}

async function lookupLrclibSong(song, fetcher = fetch) {
  const artist = String(song.artist || '').trim();
  const unknownArtist = /^(미확인|미확인한 곡|정보 없음|unknown)$/i.test(artist);
  const params = new URLSearchParams({ track_name: song.title });
  if (artist && !unknownArtist) params.set('artist_name', artist);
  const response = await fetcher(`https://lrclib.net/api/search?${params}`, {
    headers: { 'X-User-Agent': 'Yebit/1.0 (https://github.com/ryuyejun/worship-ppt-poc)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const records = await response.json();
  if (!Array.isArray(records)) return null;
  const match = records
    .filter(record => typeof record?.trackName === 'string' && songTitleScore(song.title, record.trackName) >= 0.8)
    .filter(record => (typeof record.plainLyrics === 'string' && record.plainLyrics.trim()) || (typeof record.syncedLyrics === 'string' && record.syncedLyrics.trim()))
    .sort((left, right) => songTitleScore(song.title, right.trackName) - songTitleScore(song.title, left.trackName))[0];
  if (!match) return null;
  const lyrics = (match.plainLyrics || match.syncedLyrics.replace(/^\[\d{2}:\d{2}(?:\.\d+)?\]\s*/gm, '')).trim();
  return { ...song, id: -(300000000 + Number(match.id || song.id)), artist: match.artistName || song.artist,
    title: match.trackName || song.title, source: match.id ? `https://lrclib.net/track/${match.id}` : 'https://lrclib.net',
    status: 'USER_SUPPLIED', lyrics };
}

async function lookupYouTubeSong(song, apiKey) {
  if (!apiKey) return null;
  const candidates = await searchYouTubeLyrics(song.title, apiKey);
  const match = candidates
    .filter(candidate => candidate.lyrics.trim())
    .map(candidate => ({ candidate, score: songTitleScore(song.title, candidate.title) }))
    .sort((left, right) => right.score - left.score || right.candidate.lyrics.length - left.candidate.lyrics.length)[0];
  if (!match || match.score < 0.5) return null;
  return { ...song, id: -(200000000 + Number(song.id)), title: song.title, artist: match.candidate.artist || song.artist,
    source: match.candidate.url, status: 'USER_SUPPLIED', lyrics: match.candidate.lyrics };
}

async function lookupTrendingVideoLyrics(song, videoId, apiKey) {
  if (!apiKey || !/^[\w-]{11}$/.test(videoId || '')) return null;
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.search = new URLSearchParams({ part: 'snippet', id: videoId, key: apiKey }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('YouTube video lookup failed');
  const payload = await response.json();
  const video = Array.isArray(payload.items) ? payload.items.find(item => item.id === videoId) : null;
  const lyrics = extractLyrics(video?.snippet?.description || '');
  if (!lyrics) return null;
  return { ...song, id: -(200000000 + Number(song.id)), source: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    status: 'USER_SUPPLIED', lyrics };
}

async function getSongWithLyrics(db, songId, youtubeApiKey, trendingVideoId) {
  const stored = await getSong(db, songId);
  if (stored?.lyrics?.trim()) return stored;
  const row = await db.prepare('SELECT id, title, lyricist, composer, artist, lyrics_status, source_url, category, hymn_number FROM songs WHERE id = ? LIMIT 1').bind(songId).first();
  if (!row) return null;
  const song = { id: row.id, title: row.title, author: row.lyricist, composer: row.composer, artist: row.artist,
    status: row.lyrics_status, source: row.source_url, category: row.category, hymnNumber: row.hymn_number };
  try {
    const lrclib = await lookupLrclibSong(song);
    if (lrclib) return lrclib;
  } catch { /* LRCLIB fail/limit: continue to YouTube. */ }
  try {
    const trendingVideo = await lookupTrendingVideoLyrics(song, trendingVideoId, youtubeApiKey);
    if (trendingVideo) return trendingVideo;
  } catch { /* Use the generic YouTube search as a fallback. */ }
  try {
    const youtube = await lookupYouTubeSong(song, youtubeApiKey);
    if (youtube) return youtube;
  } catch { /* Keep the song metadata and return no lyrics. */ }
  return song;
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
    const path = new URL(request.url).pathname;
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
      if (path === '/batch-import' || path === '/requests/complete') return fail('웹에서 곡을 변경하는 기능은 아직 사용할 수 없습니다.', 403);
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
      if (path === '/song-lyrics') {
        if (!Number.isSafeInteger(input?.id) || input.id < 1) return fail('곡 번호를 확인해 주세요.', 400);
        if (input?.videoId != null && (typeof input.videoId !== 'string' || !/^[\w-]{11}$/.test(input.videoId))) return fail('영상 정보를 확인해 주세요.', 400);
        const song = await getSongWithLyrics(env.DB, input.id, env.YOUTUBE_API_KEY, input.videoId);
        if (!song) return fail('곡을 찾을 수 없습니다.', 404);
        if (!song.lyrics?.trim()) return fail('DB, LRCLIB, YouTube 영상 설명란에서 가사를 찾지 못했습니다.', 404);
        return ok(song);
      }
      if (path === '/requests') {
        const query = typeof input?.query === 'string' ? input.query.trim().slice(0, 255) : '';
        const { results } = await env.DB.prepare("SELECT id, title, lyricist, request_count AS count FROM song_requests WHERE status = 'PENDING' AND (title LIKE ? OR lyricist LIKE ?) ORDER BY updated_at DESC LIMIT 100")
          .bind(`%${query}%`, `%${query}%`).all();
        return ok(results);
      }
      if (path === '/providers/search') {
        const title = typeof input?.title === 'string' ? input.title.trim().slice(0, 100) : '';
        if (!title) return ok({ candidates: [], status: ['검색어를 입력해 주세요'] });
        if (!env.YOUTUBE_API_KEY) return ok({ candidates: [], status: ['YouTube 검색 키가 설정되지 않았습니다'] });
        try {
          const candidates = await searchYouTubeLyrics(title, env.YOUTUBE_API_KEY);
          const lyricCandidates = candidates.filter(item => item.lyrics.trim());
          return ok({ candidates: lyricCandidates, status: [`YouTube에서 가사 본문 ${lyricCandidates.length}개 확인`] });
        } catch {
          return ok({ candidates: [], status: ['YouTube 가사 검색에 실패했습니다'] });
        }
      }
      return ok(await findArtwork(env.DB, input?.songId, env.PIXABAY_API_KEY, input?.title));
    } catch (error) {
      if (error instanceof TypeError) return fail('곡 제목을 확인해 주세요.', 400);
      return fail('곡 조회 중 오류가 발생했습니다.', 500);
    }
  },
};
