import { createHash } from 'node:crypto';

export function normalizeTitle(value) {
  return String(value ?? '').normalize('NFC').toLocaleLowerCase('ko-KR').replace(/\s+/gu, '');
}

export async function findSongs(db, title) {
  const normalized = normalizeTitle(title);
  if (!normalized || normalized.length > 255) throw new Error('곡 제목을 확인해 주세요.');
  const songs = new Map();
  const direct = await db.collection('songs').where('normalized_title', '==', normalized).limit(100).get();
  for (const doc of direct.docs) songs.set(doc.id, doc.data());
  const aliases = await db.collection('song_aliases').where('normalized_alias', '==', normalized).limit(100).get();
  for (const alias of aliases.docs) {
    const id = String(alias.data().song_id);
    if (!songs.has(id)) {
      const doc = await db.collection('songs').doc(id).get();
      if (doc.exists) songs.set(id, doc.data());
    }
  }
  if (/^\d{1,3}$/.test(normalized)) {
    const hymns = await db.collection('songs').where('hymn_number', '==', Number(normalized)).limit(100).get();
    for (const doc of hymns.docs) songs.set(doc.id, doc.data());
  }
  return [...songs.values()].filter(song => typeof song.lyrics === 'string' && song.lyrics.trim() && song.lyrics_status === 'USER_SUPPLIED');
}

export async function requestMissingSong(db, title) {
  const normalized = normalizeTitle(title);
  if (!normalized || normalized.length > 255) throw new Error('곡 제목을 확인해 주세요.');
  const id = createHash('sha256').update(normalized).digest('hex');
  const ref = db.collection('song_requests').doc(`title-${id}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const now = new Date().toISOString();
    const old = snapshot.data();
    const count = (old?.request_count ?? 0) + 1;
    transaction.set(ref, { title: title.trim(), normalized_title: normalized, lyricist: null,
      normalized_lyricist: '', status: 'PENDING', request_count: count,
      created_at: old?.created_at ?? now, updated_at: now, song_id: null });
    return count;
  });
}
