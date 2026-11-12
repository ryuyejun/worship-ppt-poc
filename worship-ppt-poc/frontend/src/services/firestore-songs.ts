import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { firestore } from '../firebase';
import type { Song } from '../types';

export function normalizeSongTitle(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('ko-KR').replace(/\s+/gu, '');
}

type StoredSong = {
  id: number; title: string; lyricist?: string | null; composer?: string | null;
  artist?: string | null; lyrics?: string | null; source_url?: string | null;
  lyrics_status?: string; category?: string | null; hymn_number?: number | null;
};

export function toSong(value: StoredSong): Song {
  return {
    id: Number(value.id), title: value.title, author: value.lyricist ?? null,
    composer: value.composer ?? null, artist: value.artist ?? null,
    lyrics: value.lyrics ?? undefined, source: value.source_url ?? null,
    status: value.lyrics_status ?? 'PENDING', category: value.category ?? null,
    hymnNumber: value.hymn_number ?? null,
  };
}

/** Requires an authenticated user and appropriate Firestore security rules. */
export async function findFirebaseSongs(title: string): Promise<Song[]> {
  if (!firestore) throw new Error('Firebase 설정이 없습니다.');
  const normalized = normalizeSongTitle(title);
  if (!normalized || normalized.length > 255) throw new Error('곡 제목을 확인해 주세요.');
  const results = new Map<number, Song>();
  const matches = await getDocs(query(collection(firestore, 'songs'), where('normalized_title', '==', normalized), limit(100)));
  for (const item of matches.docs) {
    const song = toSong(item.data() as StoredSong); results.set(song.id, song);
  }
  const aliases = await getDocs(query(collection(firestore, 'song_aliases'), where('normalized_alias', '==', normalized), limit(100)));
  for (const alias of aliases.docs) {
    const id = String(alias.data().song_id);
    if (!results.has(Number(id))) {
      const item = await getDoc(doc(firestore, 'songs', id));
      if (item.exists()) { const song = toSong(item.data() as StoredSong); results.set(song.id, song); }
    }
  }
  if (/^\d{1,3}$/.test(normalized)) {
    const hymns = await getDocs(query(collection(firestore, 'songs'), where('hymn_number', '==', Number(normalized)), limit(100)));
    for (const item of hymns.docs) { const song = toSong(item.data() as StoredSong); results.set(song.id, song); }
  }
  return [...results.values()].filter(song => song.status === 'USER_SUPPLIED' && song.lyrics?.trim());
}
