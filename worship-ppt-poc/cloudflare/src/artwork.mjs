const MAX_IMAGE_BYTES = 900_000;
const CACHE_MILLISECONDS = 24 * 60 * 60 * 1000;
const unavailable = songId => ({ available: false, songId, imageUrl: null, sourceUrl: null, contributor: null });
const allowedUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'pixabay.com' || url.hostname.endsWith('.pixabay.com')); }
  catch { return false; }
};

async function imageBytes(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_IMAGE_BYTES || !response.body) return null;
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  if (!size) return null;
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function responseFor(songId, cached) {
  return cached?.image_type && cached?.source_url
    ? { available:true, songId, imageUrl:`/song-artwork/image/${songId}`, sourceUrl:cached.source_url, contributor:cached.contributor }
    : unavailable(songId);
}

export async function findArtwork(db, songId, apiKey, externalTitle) {
  if (!Number.isSafeInteger(songId) || songId === 0) return unavailable(songId || 0);
  const external = songId < 0;
  const title = typeof externalTitle === 'string' ? externalTitle.normalize('NFC').trim().slice(0, 100) : '';
  const song = external ? (title ? { title } : null) : await db.prepare('SELECT title FROM songs WHERE id = ?').bind(songId).first();
  const table = external ? 'external_song_artwork_cache' : 'song_artwork_cache';
  if (!song) return unavailable(songId);
  const cached = await db.prepare(`SELECT song_title, fetched_at, image_type, source_url, contributor FROM ${table} WHERE song_id = ?`).bind(songId).first();
  if (cached?.song_title === song.title && cached.image_type) return responseFor(songId, cached);
  if (cached?.song_title === song.title && Date.now() - Date.parse(cached.fetched_at) < CACHE_MILLISECONDS) return unavailable(songId);
  if (!apiKey) return unavailable(songId);
  const query = new URL('https://pixabay.com/api/');
  query.searchParams.set('key', apiKey); query.searchParams.set('q', song.title.slice(0, 100));
  query.searchParams.set('lang', 'ko'); query.searchParams.set('image_type', 'photo');
  query.searchParams.set('orientation', 'horizontal'); query.searchParams.set('safesearch', 'true'); query.searchParams.set('per_page', '3');
  const result = await fetch(query, { signal: AbortSignal.timeout(8000) });
  if (!result.ok) throw new Error('Pixabay search failed');
  const data = await result.json();
  if (!data || !Array.isArray(data.hits)) throw new Error('Invalid Pixabay response');
  let image = null; let type = null; let source = null; let contributor = null;
  const first = data.hits.find(hit => allowedUrl(hit?.webformatURL) && allowedUrl(hit?.pageURL));
  if (first) {
    const download = await fetch(first.webformatURL, { signal: AbortSignal.timeout(10000) });
    const mime = (download.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (download.ok && allowedUrl(download.url) && ['image/jpeg','image/png','image/webp'].includes(mime)) {
      image = await imageBytes(download);
      if (image) { type = mime; source = first.pageURL; contributor = String(first.user || '').slice(0, 200); }
    }
  }
  await db.prepare(`INSERT INTO ${table}(song_id,song_title,fetched_at,search_response,image_data,image_type,source_url,contributor)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(song_id) DO UPDATE SET song_title=excluded.song_title, fetched_at=excluded.fetched_at,
    search_response=excluded.search_response, image_data=excluded.image_data, image_type=excluded.image_type,
    source_url=excluded.source_url, contributor=excluded.contributor`)
    .bind(songId, song.title, new Date().toISOString(), JSON.stringify(data), image ? image.buffer : null, type, source, contributor).run();
  return responseFor(songId, { image_type:type, source_url:source, contributor });
}

export async function getArtworkImage(db, songId) {
  if (!Number.isSafeInteger(songId) || songId === 0) return null;
  const table = songId < 0 ? 'external_song_artwork_cache' : 'song_artwork_cache';
  const row = await db.prepare(`SELECT image_data, image_type FROM ${table} WHERE song_id = ? AND image_data IS NOT NULL`).bind(songId).first();
  if (!row || !['image/jpeg','image/png','image/webp'].includes(row.image_type)) return null;
  return { bytes: new Uint8Array(row.image_data), type: row.image_type };
}
