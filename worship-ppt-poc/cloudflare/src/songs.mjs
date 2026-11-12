const COLUMNS = 's.id, s.title, s.lyricist, s.composer, s.artist, s.lyrics_status, s.source_url, s.category, s.hymn_number';
const READY = "s.lyrics IS NOT NULL AND length(trim(s.lyrics)) > 0";
const normalize = value => value.normalize('NFC').toLocaleLowerCase('ko-KR').replace(/\s+/gu, '');

function toSong(row, includeLyrics = false) {
  return { id: row.id, title: row.title, author: row.lyricist, composer: row.composer,
    artist: row.artist, status: row.lyrics_status, source: row.source_url,
    category: row.category, hymnNumber: row.hymn_number,
    ...(includeLyrics ? { lyrics: row.lyrics } : {}) };
}

export async function listSongs(db, readyOnly) {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM songs s ${readyOnly ? `WHERE ${READY}` : ''} ORDER BY s.title, s.id`).all();
  return results.map(row => toSong(row));
}

export async function searchSongs(db, title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 255) throw new TypeError('곡 제목을 확인해 주세요.');
  const normalized = normalize(title);
  const number = /^\d{1,3}$/.test(normalized) ? Number(normalized) : null;
  const sql = `SELECT ${COLUMNS}, s.lyrics FROM songs s WHERE ${READY} AND
    (s.normalized_title = ? OR EXISTS (SELECT 1 FROM song_aliases a WHERE a.song_id = s.id AND a.normalized_alias = ?) OR (? IS NOT NULL AND s.category = 'HYMN' AND s.hymn_number = ?)) ORDER BY s.id LIMIT 100`;
  const { results } = await db.prepare(sql).bind(normalized, normalized, number, number).all();
  return results.map(row => toSong(row, true));
}

export async function getSong(db, id) {
  const result = await db.prepare(`SELECT ${COLUMNS}, s.lyrics FROM songs s WHERE s.id = ? AND ${READY} LIMIT 1`).bind(id).first();
  return result ? toSong(result, true) : null;
}

export async function queueMissing(db, title) {
  const key = normalize(title);
  const now = new Date().toISOString();
  const sql = `INSERT INTO song_requests(title,normalized_title,lyricist,normalized_lyricist,status,request_count,created_at,updated_at,song_id)
    VALUES(?,?,NULL,'','PENDING',1,?,?,NULL)
    ON CONFLICT(normalized_title,normalized_lyricist) DO UPDATE SET
      request_count = song_requests.request_count + 1, status = 'PENDING', song_id = NULL, updated_at = excluded.updated_at
    RETURNING request_count`;
  const result = await db.prepare(sql).bind(title.trim(), key, now, now).first();
  return result.request_count;
}
