import { useAutoMelodies, type AutoMelody } from './auto-melody';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ScoreSlide } from './score';
import { api, cloudflareMode } from './api';
import type { ApiResponse, Song, SongRequest } from './types';
import { collectSlides, normalizeSlideOrder, renderSlide, type Slide, type SlideSize, type SlideStyle, type SlideTextPosition } from './presentation';

type Notice = { text: string; kind?: 'error' | 'success' } | null;
type RecentSong = { id: number; title: string; artist: string | null; selectedAt: number; lyrics?: string; lyricsFilteredByVocalBounds?: boolean; lyricsFromAudio?: boolean; captionFormatVersion?: number; source?: string | null; youtubeVideoId?: string; youtubePlaylistId?: string; artworkUrl?: string; artworkSourceUrl?: string; artworkContributor?: string };
type SelectedSong = Song & { originalPpt?: boolean };
type FavoriteArtwork = { imageUrl: string; sourceUrl?: string; contributor?: string };
type PptStyle = {
  backgroundColor: string; textColor: string; fontFamily: string; fontSize: number;
  alignment: 'LEFT' | 'CENTER' | 'RIGHT'; linesPerSlide: number; bold: boolean;
  textX: number; textY: number; textWidth: number; textHeight: number;
};
type Preview = { imageBase64: string; slideIndex: number; slideCount: number };
type PptPayload = { slideSize?: SlideSize; songIds: number[]; autoMelodies?: Record<number, AutoMelody>; extraSlides?: number; removedSlideIndexes?: number[]; slideOrder?: number[]; slidePositions?: Record<number, SlideTextPosition>; slideTextOverrides?: Record<number, string>; slideTextColors?: Record<number, string>; externalSongs?: { id: number; title: string; artist: string | null; lyrics: string }[]; style: PptStyle };

function moveIndexedValues<T>(values: Record<number, T>, from: number, to: number, count: number): Record<number, T> {
  const ordered = Array.from({ length: count }, (_, index) => values[index]);
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  return Object.fromEntries(ordered.flatMap((value, index) => value === undefined ? [] : [[index, value]])) as Record<number, T>;
}

function recentTitleKey(title: string) {
  return title.normalize('NFC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function liveSongSuggestions(query: string, songs: Song[]) {
  const key = recentTitleKey(query);
  if (!key) return [] as { label: string; songs: Song[] }[];

  const uniqueSongs = [...new Map(songs.map((song) => [song.id, song])).values()];
  if (/^\d{1,3}$/.test(query.trim())) {
    const numbered = uniqueSongs.filter((song) => song.hymnNumber === Number(query.trim()));
    return numbered.length ? [{ label: '찬송가 번호', songs: numbered.slice(0, 4) }] : [];
  }

  const titleMatches = uniqueSongs
    .filter((song) => recentTitleKey(song.title).includes(key))
    .sort((a, b) => {
      const rank = (song: Song) => {
        const title = recentTitleKey(song.title);
        return title === key ? 0 : title.startsWith(key) ? 1 : 2;
      };
      return rank(a) - rank(b) || a.title.localeCompare(b.title, 'ko');
    });
  const usedIds = new Set(titleMatches.map((song) => song.id));
  const artistMatches = uniqueSongs.filter((song) => !usedIds.has(song.id)
    && Boolean(song.artist && recentTitleKey(song.artist).includes(key)));
  artistMatches.forEach((song) => usedIds.add(song.id));
  const creditMatches = uniqueSongs.filter((song) => !usedIds.has(song.id)
    && [song.author, song.composer].some((value) => value && recentTitleKey(value).includes(key)));

  return [
    titleMatches.length ? { label: '곡 제목', songs: titleMatches.slice(0, 5) } : null,
    artistMatches.length ? { label: '가수·찬양팀', songs: artistMatches.slice(0, 3) } : null,
    creditMatches.length ? { label: '작사·작곡', songs: creditMatches.slice(0, 3) } : null,
  ].filter((group): group is { label: string; songs: Song[] } => group !== null);
}

function lyricsPreviewText(lyrics: string) {
  const numberMarker = /^[\s\uFEFF\u200B]*(?:\(\s*\d{1,3}\s*\)|(?:제\s*)?\d{1,3}\s*(?:[.)、．]|절[.)、．]?)|(?:verse|stanza)\s*\d{1,3}[.)、．:]?|[①②③④⑤⑥⑦⑧⑨⑩])\s*/iu;
  const numberOnly = /^[\s\uFEFF\u200B]*(?:(?:\(\s*\d{1,3}\s*\))|(?:(?:제\s*)?\d{1,3}\s*(?:[.)、．]|절[.)、．]?)?)|(?:verse|stanza)\s*\d{1,3}[.)、．:]?|[①②③④⑤⑥⑦⑧⑨⑩])\s*$/iu;
  return lyrics.split(/\r\n|\r|\n/).map((rawLine) => {
    let line = rawLine.replace(/^[\s\uFEFF\u200B]*(?:\[\d{1,3}:[0-5]\d(?:[.:,]\d{1,3})?\]\s*)+/u, '').trim();
    for (let index = 0; index < 6; index += 1) {
      const cleaned = line
        .replace(/^[\s\uFEFF\u200B]*(?:\[\d{1,3}:[0-5]\d(?:[.:,]\d{1,3})?\]\s*)+/u, '')
        .replace(numberMarker, '').trim();
      if (cleaned === line) break;
      line = cleaned;
    }
    return line;
  }).filter((line) => Boolean(line) && !numberOnly.test(line)).join('\n').trim();
}

function uniqueRecentSongs(songs: RecentSong[]) {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = recentTitleKey(song.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function youtubeThumbnailUrl(videoId?: string | null) {
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return undefined;
  return cloudflareMode ? `/youtube-thumbnail/${videoId}` : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function youtubeVideoIdFromUrl(url?: string | null) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const videoId = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : undefined;
  } catch {
    return undefined;
  }
}

const defaultPptStyle: PptStyle = { backgroundColor: '#ffffff', textColor: '#202124', fontFamily: 'Apple SD Gothic Neo', fontSize: 40, alignment: 'CENTER', linesPerSlide: 2, bold: false, textX: 50, textY: 50, textWidth: 87.5, textHeight: 55.6 };

function displayPerson(value?: string | null) {
  return value?.trim() || '정보 없음';
}

function displayKnown(value?: string | null) {
  const text = value?.trim() ?? '';
  return /^(미확인|미확인한 곡|정보 없음|unknown)$/i.test(text) ? '' : text;
}

function ScoreRowsOverlay({ rows, fontFamily, fontSize, color, bold, onSelect }: {
  rows: ScoreSlide['rows']; fontFamily: string; fontSize: number; color: string; bold: boolean; onSelect?: () => void;
}) {
  return <div className="editor-score-overlay" role={onSelect ? 'button' : undefined}
    tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? '가사 텍스트 선택' : undefined}
    style={onSelect ? { pointerEvents: 'auto' } : undefined}
    onClick={onSelect} onKeyDown={event => {
      if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); }
    }}>{rows.map((row, index) => <div className="editor-score-overlay__row" key={index}>
    {row.staff && <img src={row.staff} alt="오선 악보" />}
    <span style={{ fontFamily, fontSize: `${fontSize / 960 * 100}cqw`, color, fontWeight: bold ? 700 : 500 }}>{row.lyrics}</span>
  </div>)}</div>;
}

async function authRequest<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success) throw new Error(payload.error || '인증 요청을 처리하지 못했습니다.');
  return payload.data;
}

function trackSearchGlassReflection(event: React.PointerEvent<HTMLDivElement>) {
  if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const glass = event.currentTarget.querySelector<HTMLElement>('.editor-search-widget');
  if (!glass) return;
  const bounds = glass.getBoundingClientRect();
  glass.style.setProperty('--glass-x', `${((event.clientX - bounds.left) / bounds.width) * 100}%`);
  glass.style.setProperty('--glass-y', `${((event.clientY - bounds.top) / bounds.height) * 100}%`);
}

function resetSearchGlassReflection(event: React.PointerEvent<HTMLDivElement>) {
  if (event.pointerType !== 'mouse') return;
  const glass = event.currentTarget.querySelector<HTMLElement>('.editor-search-widget');
  glass?.style.setProperty('--glass-x', '50%');
  glass?.style.setProperty('--glass-y', '0%');
}

function downloadPpt(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorshipApp() {
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'anonymous'>('checking');
  const [authUser, setAuthUser] = useState<{ id: number; email: string } | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordVisible, setAuthPasswordVisible] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authFieldErrors, setAuthFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [page, setPage] = useState<'create' | 'manage'>(window.location.hash === '#manage' ? 'manage' : 'create');
  const [mobileEditorView, setMobileEditorView] = useState<'songs' | 'slides'>('songs');
  const [navOpen, setNavOpen] = useState(false);
  const [readySongs, setReadySongs] = useState<Song[]>([]);
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWidgetRef = useRef<HTMLDivElement>(null);
  const selectedQueueRef = useRef<HTMLElement>(null);
  const draggedSongIdRef = useRef<number | null>(null);
  const originalSongOrderRef = useRef<number[] | null>(null);
  const pendingSongPositionsRef = useRef<Map<number, number>>(new Map());
  const [draggedSongId, setDraggedSongId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const result = await authRequest<{ user: { id: number; email: string } }>('/auth/me', 'GET');
        if (!cancelled) { setAuthUser(result.user); setAuthStatus('authenticated'); }
      } catch {
        try {
          const result = await authRequest<{ user: { id: number; email: string } }>('/auth/refresh', 'POST');
          if (!cancelled) { setAuthUser(result.user); setAuthStatus('authenticated'); }
        } catch {
          if (!cancelled) setAuthStatus('anonymous');
        }
      }
    }
    void restoreSession();
    return () => { cancelled = true; };
  }, []);

  const artworkAttempts = useRef(new Set<string>());
  const artworkQueue = useRef<(Pick<Song, 'id' | 'title'> & { artist?: string | null })[]>([]);
  const activeArtworkRequests = useRef(0);
  const createPptShortcut = useRef<() => void>(() => undefined);
  const addSelectionShortcut = useRef<(song: Song) => void>(() => undefined);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [selected, setSelected] = useState<SelectedSong[]>([]);
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [searchNotice, setSearchNotice] = useState<Notice>(null);
  const [pptNotice, setPptNotice] = useState<Notice>(null);
  const [creating, setCreating] = useState(false);
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [requestQuery, setRequestQuery] = useState('');
  const [requestNotice, setRequestNotice] = useState<Notice>(null);
  const [importNotice, setImportNotice] = useState<Notice>(null);
  const [importing, setImporting] = useState(false);
  const pptStyle = defaultPptStyle;
  const [libraryError, setLibraryError] = useState('');
  const [editorTab, setEditorTab] = useState<'songs' | 'favorites' | 'trending'>('songs');
  const [youtubeVideos, setYoutubeVideos] = useState<{ videoId: string; songId: number; title: string; artworkUrl: string | null }[]>([]);
  const [youtubeStatus, setYoutubeStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [recentSongs, setRecentSongs] = useState<RecentSong[]>(() => {
    try {
      const stored = window.localStorage.getItem('yebit.recent-songs');
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(parsed)) return [];
      const songs = parsed.filter((song): song is RecentSong => song && Number.isInteger(song.id)
        && song.id !== 0 && typeof song.title === 'string' && typeof song.selectedAt === 'number');
      return uniqueRecentSongs(songs).slice(0, 5);
    } catch {
      return [];
    }
  });
  const [favoriteArtwork, setFavoriteArtwork] = useState<Record<number, FavoriteArtwork>>({});
  const [pendingFavoriteRemovals, setPendingFavoriteRemovals] = useState<number[]>([]);
  const [songSelectionCounts, setSongSelectionCounts] = useState<Record<number, number>>(() => {
    try {
      const stored = window.localStorage.getItem('yebit.song-selection-counts');
      const parsed: unknown = stored ? JSON.parse(stored) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([id, count]) => /^\d+$/.test(id) && Number(id) > 0 && Number.isSafeInteger(count) && Number(count) > 0)) as Record<number, number>;
    } catch {
      return {};
    }
  });
  const [favoriteIds, setFavoriteIds] = useState<number[]>(() => {
    try {
      const stored = window.localStorage.getItem('yebit.favorite-song-ids');
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
    } catch {
      return [];
    }
  });
  const [presentationTitle, setPresentationTitle] = useState('제목 없는 디자인');
  const [titleEditOpen, setTitleEditOpen] = useState(false);
  const titleControlRef = useRef<HTMLDivElement | null>(null);
  const sizeControlRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    try { return window.localStorage.getItem('yebit.dark-mode') === 'true'; } catch { return false; }
  });
  const [slideSize, setSlideSize] = useState<SlideSize>({ width:1280, height:720 });
  const [sizeOpen, setSizeOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [extraSlideCount, setExtraSlideCount] = useState(0);
  const [removedSlideIndexes, setRemovedSlideIndexes] = useState<number[]>([]);
  const [slideOrder, setSlideOrder] = useState<number[]>([]);
  const [draggedSlideIndex, setDraggedSlideIndex] = useState<number | null>(null);
  const [dropSlideIndex, setDropSlideIndex] = useState<number | null>(null);
  const draggedSlideIndexRef = useRef<number | null>(null);
  const [slidePositions, setSlidePositions] = useState<Record<number, SlideTextPosition>>({});
  const [slideTextOverrides, setSlideTextOverrides] = useState<Record<number, string>>({});
  const [slideTextColors, setSlideTextColors] = useState<Record<number, string>>({});
  const [selectedTextSlide, setSelectedTextSlide] = useState<number | null>(null);
  const [editingSlide, setEditingSlide] = useState<number | null>(null);
  const [prepared, setPrepared] = useState<{ slides: Slide[]; style: SlideStyle; thumbnails: string[]; slideSize: SlideSize } | null>(null);
  const previewCache = useRef(new Map<number, string>());
  const scoreNavigationPending = useRef('');
  const textBoxInteraction = useRef<{ mode: 'move' | 'resize'; slide: number; startX: number; startY: number; x: number; y: number; width: number; height: number; element: HTMLDivElement; bounds: DOMRect } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewRetry, setPreviewRetry] = useState(0);
  const displaySlideOrder = normalizeSlideOrder(slideOrder, prepared?.slides.length ?? preview?.slideCount ?? 0);

  const favoriteSongs = allSongs.filter((song) => favoriteIds.includes(song.id));
  const searchSuggestions = searchOpen ? liveSongSuggestions(query, [...readySongs, ...allSongs]) : [];
  const { melodies: autoMelodies, statusFor: melodyStatusFor, retry: retryMelody } = useAutoMelodies(selected);
  const previewSong = prepared?.slides[previewIndex]?.title;
  const scoreControlSong = (previewSong ? selected.find((song) => recentTitleKey(song.title) === recentTitleKey(previewSong)) : undefined) ?? selected[0] ?? activeSong;
  const statusSong = selected.find(song =>
    recentTitleKey(song.title) === scoreNavigationPending.current && melodyStatusFor(song)
  ) ?? scoreControlSong;
  const candidateAdded = activeSong && selected.some(song =>
    song.id === activeSong.id || recentTitleKey(song.title) === recentTitleKey(activeSong.title)
  );
  const melodyStatus = statusSong ? melodyStatusFor(statusSong) : undefined;
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    api<typeof youtubeVideos>('/youtube-videos').then(({ data }) => { if (!cancelled) { setYoutubeVideos(data); setYoutubeStatus('ready'); } }).catch(() => { if (!cancelled) setYoutubeStatus('error'); });
    return () => { cancelled = true; };
  }, [authStatus]);

  useEffect(() => {
    try {
      window.localStorage.setItem('yebit.favorite-song-ids', JSON.stringify(favoriteIds));
    } catch {
      // 즐겨찾기는 저장소를 사용할 수 없는 경우 현재 화면에서만 유지합니다.
    }
  }, [favoriteIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem('yebit.recent-songs', JSON.stringify(recentSongs));
    } catch {
      // 최근 선택은 저장소를 사용할 수 없는 경우 현재 화면에서만 유지합니다.
    }
  }, [recentSongs]);

  useEffect(() => {
    try {
      window.localStorage.setItem('yebit.song-selection-counts', JSON.stringify(songSelectionCounts));
    } catch {
      // 이 기기의 트렌드는 저장소를 사용할 수 없는 경우 현재 화면에서만 유지합니다.
    }
  }, [songSelectionCounts]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    for (const recent of recentSongs) {
      const videoId = recent.youtubeVideoId || youtubeVideos.find((video) => video.songId === recent.id)?.videoId;
      if (!videoId) requestSongArtwork(recent);
    }
  }, [authStatus, recentSongs, youtubeVideos]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    for (const song of favoriteSongs) {
      const hasYoutubeThumbnail = youtubeVideos.some((video) => video.songId === song.id);
      if (!hasYoutubeThumbnail) requestSongArtwork(song);
    }
  }, [authStatus, favoriteSongs, favoriteArtwork, youtubeVideos]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    for (const song of youtubeVideos) {
      if (song.songId > 0 && !favoriteArtwork[song.songId] && !song.artworkUrl) {
        requestSongArtwork({ id: song.songId, title: song.title });
      }
    }
  }, [authStatus, youtubeVideos, favoriteArtwork]);

  function selectSong(song: Song, trendingVideoId?: string) {
    const existing = selected.find(item => item.id === song.id || recentTitleKey(item.title) === recentTitleKey(song.title));
    const videoId = trendingVideoId || song.youtubeVideoId || youtubeVideoIdFromUrl(song.source)
      || youtubeVideos.find(video => video.songId === song.id)?.videoId;
    const chosen = existing ?? { ...song, youtubeVideoId: videoId };
    setActiveSong(chosen);
    setMobileEditorView('slides');
    setSearchOpen(false);
    setPptNotice(null);
  }

  function addSearchResult(song: Song) {
    const existing = selected.find(item => item.id === song.id || recentTitleKey(item.title) === recentTitleKey(song.title));
    const videoId = song.youtubeVideoId || youtubeVideoIdFromUrl(song.source)
      || youtubeVideos.find(video => video.songId === song.id)?.videoId;
    setSearchOpen(false);
    setActiveSong(null);
    if (existing) {
      changeEditorTab('songs');
      setMobileEditorView('slides');
      setPptNotice({ text: `${song.title}은(는) 이미 제작 목록에 있습니다.`, kind: 'success' });
      return;
    }
    addOriginalPpt({ ...song, youtubeVideoId: videoId });
    setPptNotice({ text: `${song.title} PPT 미리보기를 준비하고 있습니다.`, kind: 'success' });
  }

  function addOriginalPpt(song: Song) {
    if (selected.some(item => item.id === song.id || recentTitleKey(item.title) === recentTitleKey(song.title))) return;
    if (selected.length >= 100) {
      setPptNotice({ text: '한 번에 최대 100곡까지 선택할 수 있습니다.', kind: 'error' });
      return;
    }
    const videoId = song.youtubeVideoId ?? undefined;
    scoreNavigationPending.current = recentTitleKey(song.title);
    retryMelody(song);
    setRemovedSlideIndexes([]); setSlideOrder([]);
    setSelected(items => [...items, { ...song, originalPpt: true }]);
    setActiveSong(null);
    setMobileEditorView('slides');
    setPptNotice(null);
    changeEditorTab('songs');
    if (song.id > 0) setSongSelectionCounts(counts => ({ ...counts, [song.id]: (counts[song.id] ?? 0) + 1 }));
    const thumbnail = youtubeThumbnailUrl(videoId);
    if (thumbnail && song.id > 0) setFavoriteArtwork(items => ({ ...items, [song.id]: { imageUrl: thumbnail } }));
    const recent: RecentSong = { id: song.id, title: song.title, artist: song.artist, selectedAt: Date.now(),
      source: song.source, youtubeVideoId: videoId, artworkUrl: thumbnail };
    setRecentSongs(items => uniqueRecentSongs([recent, ...items]).slice(0, 5));
  }

  function openTrendingSong(songId: number) {
    const video = youtubeVideos.find(item => item.songId === songId);
    const song = allSongs.find(item => item.id === songId) ?? readySongs.find(item => item.id === songId);
    const trendingSong = song
      ? { ...song, youtubeVideoId: video?.videoId || song.youtubeVideoId || youtubeVideoIdFromUrl(song.source) }
      : video ? { ...songFromTitle(video.title, songId), youtubeVideoId: video.videoId } : null;
    if (!trendingSong) return;

    const existing = selected.find(item => item.id === trendingSong.id
      || recentTitleKey(item.title) === recentTitleKey(trendingSong.title));
    if (existing) {
      setActiveSong(null);
      setMobileEditorView('slides');
      changeEditorTab('songs');
      setPptNotice({ text: `${existing.title}은(는) 이미 제작 목록에 있습니다.`, kind: 'success' });
      return;
    }

    addOriginalPpt(trendingSong);
    setPptNotice({ text: `${trendingSong.title} PPT 미리보기를 준비하고 있습니다.`, kind: 'success' });
  }

  function openRecentSong(recent: RecentSong) {
    const song = allSongs.find(item => item.id === recent.id) ?? readySongs.find(item => item.id === recent.id);
    selectSong(song ?? { ...songFromTitle(recent.title, recent.id), artist: recent.artist, source: recent.source },
      recent.youtubeVideoId);
  }

  function songFromTitle(title: string, id = -Date.now()): Song {
    return { id, title, artist: null, author: null, composer: null, category: null, hymnNumber: null, status: '' };
  }

  async function loadSongArtwork(song: Pick<Song, 'id' | 'title'> & { artist?: string | null }) {
    try {
      const response = await api<{ videoId: string | null; imageUrl: string | null }>('/youtube-thumbnail/search', { songId: song.id, title: song.title, artist: song.artist });
      const imageUrl = response.data.videoId ? youtubeThumbnailUrl(response.data.videoId) : undefined;
      if (!imageUrl) {
        setFavoriteArtwork((items) => ({ ...items, [song.id]: { imageUrl: '' } }));
        setRecentSongs((songs) => songs.map((recent) => recent.id === song.id ? { ...recent, artworkUrl: undefined, artworkSourceUrl: undefined, artworkContributor: undefined } : recent));
        return;
      }
      const artwork = { imageUrl };
      const image = new Image();
      image.src = artwork.imageUrl;
      await image.decode().catch(() => undefined);
      setFavoriteArtwork((items) => ({ ...items, [song.id]: artwork }));
      setRecentSongs((songs) => songs.map((recent) => recent.id === song.id ? {
        ...recent,
        youtubeVideoId: response.data.videoId ?? undefined,
        artworkUrl: artwork.imageUrl,
        artworkSourceUrl: undefined,
        artworkContributor: undefined,
      } : recent));
    } catch {
      // 썸네일 검색에 실패해도 곡 검색과 선택은 계속 동작합니다.
    }
  }

  function processArtworkQueue() {
    while (activeArtworkRequests.current < 3 && artworkQueue.current.length > 0) {
      const song = artworkQueue.current.shift();
      if (!song) continue;
      activeArtworkRequests.current++;
      void loadSongArtwork(song).finally(() => {
        activeArtworkRequests.current--;
        processArtworkQueue();
      });
    }
  }

  function requestSongArtwork(song: Pick<Song, 'id' | 'title'> & { artist?: string | null }) {
    const key = `${song.id}:${song.title}`;
    if (artworkAttempts.current.has(key)) return;
    artworkAttempts.current.add(key);
    artworkQueue.current.push(song);
    processArtworkQueue();
  }

  function toggleFavorite(song: Song) {
    if (song.id <= 0) return;
    if (favoriteIds.includes(song.id)) {
      if (editorTab === 'favorites') setPendingFavoriteRemovals((ids) => ids.includes(song.id) ? ids.filter((id) => id !== song.id) : [...ids, song.id]);
      else setFavoriteIds((ids) => ids.filter((id) => id !== song.id));
      return;
    }
    requestSongArtwork(song);
    setFavoriteIds((ids) => [...ids, song.id]);
  }

  function changeEditorTab(tab: 'songs' | 'favorites' | 'trending') {
    if (editorTab === 'favorites' && tab !== 'favorites' && pendingFavoriteRemovals.length) {
      setFavoriteIds((ids) => ids.filter((id) => !pendingFavoriteRemovals.includes(id)));
      setPendingFavoriteRemovals([]);
    }
    setEditorTab(tab);
  }

  function presentationPayload(): PptPayload {
    return {
      slideSize,
      songIds: selected.filter(song => !song.originalPpt || autoMelodies[song.id]?.sheetImages?.length).map(song => song.id),
      autoMelodies,
      extraSlides: extraSlideCount,
      removedSlideIndexes,
      slideOrder,
      slidePositions,
      slideTextOverrides,
      slideTextColors,
      externalSongs: selected.filter((song) => song.id < 0 || (cloudflareMode && song.lyrics?.trim())).map((song) => ({ id: song.id, title: song.title, artist: song.artist, lyrics: song.lyrics ?? '' })),
      style: pptStyle,
    };
  }

  useEffect(() => {
    const controller = new AbortController();
    setPreviewLoading(true); setPreviewError('');
    const timer = window.setTimeout(async () => {
      try {
        const input = presentationPayload();
        const slides = await collectSlides(input, controller.signal);
        const size = input.slideSize ?? {width:1280,height:720};
        const index = Math.min(previewIndex, slides.length - 1);
        const mainImage = await renderSlide(slides[index], input.style, 1280, size);
        if (controller.signal.aborted) return;
        previewCache.current.set(index, mainImage);
        setPreview({ imageBase64: mainImage, slideIndex: index, slideCount: slides.length });
        setPreviewIndex(index);
        const thumbnails = await Promise.all(slides.map((slide) => renderSlide(slide, input.style, 1280, size)));
        if (controller.signal.aborted) return;
        setPrepared({ slides, style: input.style, thumbnails, slideSize: size });
      } catch (error) {
        if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : '미리보기를 불러오지 못했습니다.');
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [selected, pptStyle, slideSize, previewRetry, extraSlideCount, removedSlideIndexes, slideOrder, slideTextColors, autoMelodies, slideTextOverrides]);

  useEffect(() => {
    if (!prepared) return;
    let cancelled = false;
    const index = Math.min(previewIndex, prepared.slides.length - 1);
    const cached = previewCache.current.get(index);
    setPreview({ imageBase64: cached ?? prepared.thumbnails[index], slideIndex: index, slideCount: prepared.slides.length });
    if (!cached) void renderSlide(prepared.slides[index], prepared.style, 1280, prepared.slideSize).then((imageBase64) => {
      if (!cancelled) {
        previewCache.current.set(index, imageBase64);
        setPreview({ imageBase64, slideIndex: index, slideCount: prepared.slides.length });
      }
    }).catch(() => { /* 축소 미리보기는 계속 표시합니다. */ });
    return () => { cancelled = true; };
  }, [prepared, previewIndex]);

  useEffect(() => {
    const target = scoreNavigationPending.current;
    if (!target || !prepared) return;
    const scoreIndex = prepared.slides.findIndex((slide) => (slide.scorePageImage || slide.scoreRows?.length) && recentTitleKey(slide.title) === target);
    if (scoreIndex < 0) return;
    scoreNavigationPending.current = '';
    setPreviewIndex(scoreIndex);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-slide-index="${scoreIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [prepared, activeSong]);

  useEffect(() => {
    function syncPage() {
      setPage(window.location.hash === '#manage' ? 'manage' : 'create');
    }
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setNavOpen(false); setSearchOpen(false); setAccountMenuOpen(false); setSettingsOpen(false); }
    }
    document.body.classList.toggle('nav-locked', navOpen);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.classList.remove('nav-locked');
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [navOpen]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    function closeSearchOnOutsideClick(event: PointerEvent) {
      if (!searchWidgetRef.current?.contains(event.target as Node)) setSearchOpen(false);
    }
    document.addEventListener('pointerdown', closeSearchOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeSearchOnOutsideClick);
  }, [searchOpen]);

  async function loadSongs() {
    setLoadingSongs(true);
    setLibraryError('');
    try {
      const [ready, all] = await Promise.all([
        api<Song[]>('/ppt-songs'),
        api<Song[]>('/songs'),
      ]);
      setReadySongs(ready.data);
      setAllSongs(all.data);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : '곡 목록을 불러오지 못했습니다.');
    } finally {
      setLoadingSongs(false);
    }
  }

  async function loadRequests() {
    try {
      const response = await api<SongRequest[]>('/requests', { query: requestQuery });
      setRequests(response.data);
      setRequestNotice(null);
    } catch (error) {
      setRequestNotice({ text: error instanceof Error ? error.message : '대기 목록을 불러오지 못했습니다.', kind: 'error' });
    }
  }

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    void loadSongs();
    void loadRequests();
  }, [authStatus]);

  useEffect(() => {
    function closeEditorMenus(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!titleControlRef.current?.contains(target)) setTitleEditOpen(false);
      if (!sizeControlRef.current?.contains(target)) setSizeOpen(false);
    }
    document.addEventListener('pointerdown', closeEditorMenus);
    return () => document.removeEventListener('pointerdown', closeEditorMenus);
  }, []);

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    }
    document.addEventListener('pointerdown', closeAccountMenu);
    return () => document.removeEventListener('pointerdown', closeAccountMenu);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    try { window.localStorage.setItem('yebit.dark-mode', String(darkMode)); } catch { /* 저장할 수 없는 환경에서도 화면 설정은 적용합니다. */ }
  }, [darkMode]);

  function searchSongs(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = query.trim();
    const key = recentTitleKey(title);
    if (!key) return;

    const byNumber = /^\d{1,3}$/.test(title);
    const library = new Map([...readySongs, ...allSongs].map(song => [song.id, song]));
    const matches = [...library.values()].filter(song => byNumber
      ? song.hymnNumber === Number(title)
      : [song.title, song.artist, song.author, song.composer].some(value => value && recentTitleKey(value).includes(key)));
    matches.sort((a, b) => Number(recentTitleKey(b.title) === key) - Number(recentTitleKey(a.title) === key));
    if (!byNumber && !matches.some(song => recentTitleKey(song.title) === key)) {
      matches.push(songFromTitle(title));
    }

    setResults(matches);
    setSearchNotice(matches.length ? null : { text: '이 번호에 해당하는 찬송가를 찾지 못했습니다.' });
  }

  function addSelection(song: Song) {
    const normalizedSong = { ...song, lyrics: lyricsPreviewText(song.lyrics ?? '') };
    if (!normalizedSong.lyrics.trim()) {
      setPptNotice({ text: '이 기능으로 슬라이드를 만들려면 가사가 필요합니다.', kind: 'error' });
      return;
    }
    if (selected.some((item) => item.id === song.id)) {
      setPptNotice({ text: '이미 선택한 곡입니다.' });
      return;
    }
    if (selected.length >= 100) {
      setPptNotice({ text: '한 번에 최대 100곡까지 선택할 수 있습니다.', kind: 'error' });
      return;
    }
    setRemovedSlideIndexes([]); setSlideOrder([]); setSlidePositions({}); setSlideTextOverrides({}); setSlideTextColors({}); setEditingSlide(null);
    setSelected((items) => [...items, normalizedSong]);
    setPptNotice({ text: 'PPT 제작 목록에 추가했습니다.', kind: 'success' });
  }

  addSelectionShortcut.current = addSelection;

  function moveSong(index: number, delta: number) {
    setRemovedSlideIndexes([]); setSlideOrder([]); setSlidePositions({}); setSlideTextOverrides({}); setSlideTextColors({}); setEditingSlide(null);
    setSelected((items) => {
      const next = [...items];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }

  function reorderDraggedSong(targetSongId: number, pointerY: number, row: HTMLLIElement) {
    const draggedId = draggedSongIdRef.current;
    if (draggedId === null || draggedId === targetSongId) return;
    const targetIndex = selected.findIndex((song) => song.id === targetSongId);
    const draggedIndex = selected.findIndex((song) => song.id === draggedId);
    if (targetIndex < 0 || draggedIndex < 0) return;
    const bounds = row.getBoundingClientRect();
    const crossedTarget = draggedIndex < targetIndex ? pointerY >= bounds.top + bounds.height / 2 : pointerY <= bounds.top + bounds.height / 2;
    if (!crossedTarget) return;
    pendingSongPositionsRef.current = new Map(Array.from(document.querySelectorAll<HTMLElement>('.selected-list [data-song-id]'), (item) => [Number(item.dataset.songId), item.getBoundingClientRect().top]));
    setSelected((items) => {
      const fromIndex = items.findIndex((song) => song.id === draggedId);
      const toIndex = items.findIndex((song) => song.id === targetSongId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;
      const next = [...items];
      const [song] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, song);
      return next;
    });
  }

  useLayoutEffect(() => {
    const previousPositions = pendingSongPositionsRef.current;
    if (previousPositions.size === 0) return;
    const rows = document.querySelectorAll<HTMLElement>('.selected-list [data-song-id]');
    rows.forEach((row) => {
      const previousTop = previousPositions.get(Number(row.dataset.songId));
      if (previousTop === undefined) return;
      const deltaY = previousTop - row.getBoundingClientRect().top;
      if (!deltaY) return;
      row.style.transition = 'none';
      row.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        row.style.transition = 'transform 180ms cubic-bezier(.2,.75,.25,1)';
        row.style.transform = '';
      });
    });
    previousPositions.clear();
  }, [selected]);

  function removeSlide(visibleIndex: number) {
    const slideCount = prepared?.slides.length ?? preview?.slideCount ?? 0;
    if (visibleIndex < 0 || visibleIndex >= slideCount) return;
    const order = normalizeSlideOrder(slideOrder, slideCount);
    const sourceVisibleIndex = order[visibleIndex] ?? visibleIndex;
    let originalIndex = 0;
    let visibleCount = 0;
    while (visibleCount < sourceVisibleIndex) {
      if (!removedSlideIndexes.includes(originalIndex)) visibleCount += 1;
      originalIndex += 1;
    }
    while (removedSlideIndexes.includes(originalIndex)) originalIndex += 1;
    setRemovedSlideIndexes((indexes) => [...indexes, originalIndex]);
    setSlideOrder(order.filter(index => index !== sourceVisibleIndex).map(index => index > sourceVisibleIndex ? index - 1 : index));
    setSlideTextOverrides({});
    setSlidePositions({});
    setSlideTextColors({});
    setPreviewIndex(Math.max(0, visibleIndex - 1));
    setSelectedTextSlide(null);
    setEditingSlide(null);
  }

  function reorderSlides(fromIndex: number, toIndex: number) {
    const slideCount = prepared?.slides.length ?? preview?.slideCount ?? 0;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= slideCount || toIndex >= slideCount) return;
    const order = normalizeSlideOrder(slideOrder, slideCount);
    const activeSourceIndex = order[previewIndex] ?? previewIndex;
    const nextOrder = [...order];
    const [moved] = nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, moved);
    setSlideOrder(nextOrder);
    setSlidePositions(values => moveIndexedValues(values, fromIndex, toIndex, slideCount));
    setSlideTextOverrides(values => moveIndexedValues(values, fromIndex, toIndex, slideCount));
    setSlideTextColors(values => moveIndexedValues(values, fromIndex, toIndex, slideCount));
    setPreviewIndex(nextOrder.indexOf(activeSourceIndex));
    setSelectedTextSlide(null);
    setEditingSlide(null);
  }

  function startTextBoxInteraction(event: ReactPointerEvent<HTMLElement>, slide: number, position: SlideTextPosition, mode: 'move' | 'resize' = 'move') {
    const element = (mode === 'resize' ? event.currentTarget.parentElement : event.currentTarget) as HTMLDivElement | null;
    if (!element) return;
    const bounds = element.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    delete element.dataset.nextX; delete element.dataset.nextY; delete element.dataset.nextWidth; delete element.dataset.nextHeight;
    event.preventDefault();
    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    textBoxInteraction.current = { mode, slide, startX: event.clientX, startY: event.clientY, ...position, element, bounds };
  }

  function moveTextBoxInteraction(event: ReactPointerEvent<HTMLElement>) {
    const interaction = textBoxInteraction.current;
    if (!interaction) return;
    const dx = (event.clientX - interaction.startX) / interaction.bounds.width * 100;
    const dy = (event.clientY - interaction.startY) / interaction.bounds.height * 100;
    const x = interaction.mode === 'move' ? Math.max(interaction.width / 2, Math.min(100 - interaction.width / 2, interaction.x + dx)) : interaction.x;
    const y = interaction.mode === 'move' ? Math.max(interaction.height / 2, Math.min(100 - interaction.height / 2, interaction.y + dy)) : interaction.y;
    const width = interaction.mode === 'resize' ? Math.max(20, Math.min(100, interaction.width + dx * 2)) : interaction.width;
    const height = interaction.mode === 'resize' ? Math.max(20, Math.min(100, interaction.height + dy * 2)) : interaction.height;
    const snappedX = interaction.mode === 'move' && Math.abs(x - 50) < 2.5 ? 50 : x;
    const snappedY = interaction.mode === 'move' && Math.abs(y - 50) < 2.5 ? 50 : y;
    const page = interaction.element.closest('.editor-page-sheet');
    page?.classList.toggle('is-snap-x', snappedX === 50);
    page?.classList.toggle('is-snap-y', snappedY === 50);
    interaction.element.style.left = `${snappedX - width / 2}%`;
    interaction.element.style.top = `${snappedY - height / 2}%`;
    interaction.element.style.width = `${width}%`;
    interaction.element.style.height = `${height}%`;
    const box = interaction.element.classList.contains('text-box-selection') ? interaction.element : interaction.element.parentElement?.querySelector<HTMLElement>('.text-box-selection');
    const text = interaction.element.classList.contains('editor-slide-text') ? interaction.element : interaction.element.parentElement?.querySelector<HTMLElement>('.editor-slide-text');
    for (const sibling of [box, text]) if (sibling && sibling !== interaction.element) { sibling.style.left = `${snappedX - width / 2}%`; sibling.style.top = `${snappedY - height / 2}%`; sibling.style.width = `${width}%`; sibling.style.height = `${height}%`; }
    interaction.element.dataset.nextX = String(snappedX); interaction.element.dataset.nextY = String(snappedY);
    interaction.element.dataset.nextWidth = String(width); interaction.element.dataset.nextHeight = String(height);
  }

  function endTextBoxInteraction() {
    const interaction = textBoxInteraction.current;
    if (!interaction) return;
    const position = { x: Number(interaction.element.dataset.nextX ?? interaction.x), y: Number(interaction.element.dataset.nextY ?? interaction.y), width: Number(interaction.element.dataset.nextWidth ?? interaction.width), height: Number(interaction.element.dataset.nextHeight ?? interaction.height) };
    setSlidePositions((positions) => ({ ...positions, [interaction.slide]: position }));
    interaction.element.closest('.editor-page-sheet')?.classList.remove('is-snap-x', 'is-snap-y');
    textBoxInteraction.current = null;
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    const fieldErrors: { email?: string; password?: string } = {};
    const normalizedEmail = authEmail.trim();
    if (!normalizedEmail) fieldErrors.email = '이메일 주소를 입력해 주세요.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) fieldErrors.email = '이메일 주소 형식을 확인해 주세요.';
    if (!authPassword) fieldErrors.password = '비밀번호를 입력해 주세요.';
    else if (authMode === 'signup' && authPassword.length < 10) fieldErrors.password = '비밀번호를 10자 이상 입력해 주세요.';
    if (Object.keys(fieldErrors).length > 0) {
      setAuthFieldErrors(fieldErrors);
      return;
    }
    setAuthFieldErrors({});
    setAuthSubmitting(true);
    try {
      const path = authMode === 'signup' ? '/auth/signup' : '/auth/login';
      const result = await authRequest<{ user: { id: number; email: string } }>(path, 'POST', { email: normalizedEmail, password: authPassword });
      setAuthUser(result.user);
      setAuthPassword('');
      setAuthPasswordVisible(false);
      setAuthStatus('authenticated');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '로그인 요청을 처리하지 못했습니다.');
    } finally {
      setAuthSubmitting(false);
    }
  }

  function switchAuthMode() {
    setAuthMode((mode) => mode === 'login' ? 'signup' : 'login');
    setAuthError('');
    setAuthFieldErrors({});
    setAuthPassword('');
    setAuthPasswordVisible(false);
  }

  async function signOut() {
    try { await authRequest<{ loggedOut: boolean }>('/auth/logout', 'POST'); } catch { /* 세션이 이미 만료된 경우에도 화면에서 로그아웃합니다. */ }
    setAuthUser(null);
    setAuthStatus('anonymous');
    setAuthPassword('');
  }

  async function createPpt() {
    const unavailable = selected.find(song => song.originalPpt && !autoMelodies[song.id]?.sheetImages?.length);
    if (unavailable) {
      const status = melodyStatusFor(unavailable);
      setPptNotice({ text: `${unavailable.title} · ${status?.message ?? 'PPT를 불러오는 중입니다.'}`, kind: 'error' });
      return;
    }
    setCreating(true);
    setPptNotice({ text: 'PPTX 파일을 만들고 있습니다.' });
    try {
      const response = await api<Blob>('/ppt/batch', presentationPayload());
      const fileTitle = presentationTitle.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || '찬양 PPT';
      downloadPpt(response.data, `${fileTitle}.pptx`);
      setPptNotice({ text: 'PPTX를 다운로드했습니다.', kind: 'success' });
    } catch (error) {
      setPptNotice({ text: error instanceof Error ? error.message : 'PPTX 생성에 실패했습니다.', kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  createPptShortcut.current = () => { void createPpt(); };

  useEffect(() => {
    function handleEditorShortcuts(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setNavOpen(false);
        setSearchOpen(false);
        setEditingSlide(null);
        setSelectedTextSlide(null);
        setSizeOpen(false);
        setTitleEditOpen(false);
        return;
      }

      const target = event.target;
      const editingText = target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );
      if (editingText) return;

      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        createPptShortcut.current();
        return;
      }
      if (commandKey && !event.altKey && event.key === 'Enter' && activeSong) {
        event.preventDefault();
        addOriginalPpt(activeSong);
        return;
      }
      if (page === 'create' && prepared?.slides.length && (event.key === 'PageDown' || event.key === 'PageUp')) {
        event.preventDefault();
        const direction = event.key === 'PageDown' ? 1 : -1;
        setPreviewIndex((index) => Math.max(0, Math.min(prepared.slides.length - 1, index + direction)));
      }
    }

    document.addEventListener('keydown', handleEditorShortcuts);
    return () => document.removeEventListener('keydown', handleEditorShortcuts);
  }, [activeSong, selected, page, prepared]);

  async function importFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    if (files.length > 50 || files.reduce((size, file) => size + file.size, 0) > 8_000_000) {
      setImportNotice({ text: '파일은 최대 50개, 전체 용량은 8MB까지 선택할 수 있습니다.', kind: 'error' });
      return;
    }
    setImporting(true);
    setImportNotice({ text: '가사 파일을 확인하고 있습니다.' });
    try {
      const entries = await Promise.all(files.map(async (file) => ({
        name: file.name,
        data: await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error(`${file.name} 파일을 읽지 못했습니다.`));
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(file);
        }),
      })));
      const result = await api<{ saved: number; skipped: number }>('/batch-import', { files: entries });
      setImportNotice({ text: `가사 ${result.data.saved}곡을 저장했고 ${result.data.skipped}건은 건너뛰었습니다.`, kind: 'success' });
      await loadSongs();
    } catch (error) {
      setImportNotice({ text: error instanceof Error ? error.message : '파일 가져오기에 실패했습니다.', kind: 'error' });
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  }

  async function completeRequest(request: SongRequest, songId: number) {
    try {
      await api('/requests/complete', { id: request.id, songId });
      setRequestNotice({ text: '곡 요청을 완료 처리했습니다.', kind: 'success' });
      await loadRequests();
    } catch (error) {
      setRequestNotice({ text: error instanceof Error ? error.message : '요청을 완료하지 못했습니다.', kind: 'error' });
    }
  }

  if (authStatus !== 'authenticated') {
    return <main className="auth-screen">
      <section className={`auth-card${authMode === 'signup' ? ' is-signup' : ''}`} aria-label="Yebit 계정">
        <div className="auth-main" aria-labelledby="auth-title">
          <div className="auth-brand"><img src="/assets/figma/editor-logo.png" width="46" height="46" alt="" /><span>Yebit</span></div>
          <div className="auth-form-content">
            <p className="auth-eyebrow">찬양 PPT 제작</p>
            <h1 id="auth-title">{authStatus === 'checking' ? '로그인 상태를 확인하고 있습니다' : authMode === 'login' ? '로그인' : '회원가입'}</h1>
            {authStatus === 'checking' ? <p className="auth-help">잠시만 기다려 주세요.</p> : <>
              <p className="auth-form-intro">{authMode === 'login' ? '계정에 로그인해 계속 이용하세요.' : '이메일로 Yebit 계정을 만들어 보세요.'}</p>
              <form className="auth-form" noValidate onSubmit={submitAuth}>
                <label>이메일<input type="email" name="email" autoComplete="email" required maxLength={254} value={authEmail} onChange={(event) => { setAuthEmail(event.target.value); setAuthFieldErrors((errors) => ({ ...errors, email: undefined })); setAuthError(''); }} placeholder="이메일 주소" aria-invalid={Boolean(authFieldErrors.email)} aria-describedby={authFieldErrors.email ? 'auth-email-error' : undefined} /><span id="auth-email-error" className={`auth-field-message${authFieldErrors.email ? ' is-error' : ''}`} role="status" aria-live="polite">{authFieldErrors.email || '\u00a0'}</span></label>
                <label>비밀번호<div className="auth-password-control"><input type={authPasswordVisible ? 'text' : 'password'} name="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required minLength={authMode === 'signup' ? 10 : undefined} maxLength={128} value={authPassword} onChange={(event) => { setAuthPassword(event.target.value); setAuthFieldErrors((errors) => ({ ...errors, password: undefined })); setAuthError(''); }} placeholder={authMode === 'signup' ? '10자 이상 입력' : '비밀번호'} aria-invalid={Boolean(authFieldErrors.password)} aria-describedby={authFieldErrors.password ? 'auth-password-message' : authMode === 'signup' && authPassword.length > 0 && authPassword.length < 10 ? 'auth-password-message' : undefined} /><button className="auth-password-toggle" type="button" aria-label={authPasswordVisible ? '비밀번호 숨기기' : '비밀번호 표시'} aria-pressed={authPasswordVisible} onClick={() => setAuthPasswordVisible((visible) => !visible)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.7"/>{!authPasswordVisible && <path d="m4 4 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>}</svg></button></div><span id="auth-password-message" className={`auth-field-message${authFieldErrors.password ? ' is-error' : authMode === 'signup' && authPassword.length > 0 && authPassword.length < 10 ? ' is-hint' : ''}`} role="status" aria-live="polite">{authFieldErrors.password || (authMode === 'signup' && authPassword.length > 0 && authPassword.length < 10 ? `비밀번호를 10자 이상 입력해 주세요. (${authPassword.length}/10)` : '\u00a0')}</span></label>
                <p className={`auth-error${authError ? ' is-visible' : ''}`} role="alert">{authError || '\u00a0'}</p>
                <button className="auth-submit" type="submit" disabled={authSubmitting}>{authSubmitting ? '처리 중…' : authMode === 'login' ? '로그인' : '회원가입'}</button>
              </form>
              <div className="auth-mobile-switch">
                <span>{authMode === 'login' ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}</span>
                <button type="button" onClick={switchAuthMode} disabled={authSubmitting}>{authMode === 'login' ? '회원가입' : '로그인'}</button>
              </div>
            </>}
          </div>
        </div>
        <aside className="auth-promo">
          <div className="auth-promo-copy">
            <p>Yebit</p>
            <h2>{authMode === 'login' ? '다시 만나 반가워요' : '환영합니다'}</h2>
            <span>{authMode === 'login' ? '로그인하고 이어서 찬양 PPT를 준비하세요.' : '계정을 만들고 예배 찬양을 위한 PPT를 준비해 보세요.'}</span>
          </div>
          <button type="button" className="auth-mode-toggle" onClick={switchAuthMode} disabled={authStatus === 'checking'}>{authMode === 'login' ? '회원가입' : '로그인'}</button>
        </aside>
      </section>
    </main>;
  }

  return (
    <>
      {page === 'manage' && <header className={`nav app-nav${navOpen ? ' is-open' : ''}`}>
        <div className="wrap nav__bar">
          <a className="skip-link" href="#manage">본문 바로가기</a>
          <a className="nav__logo app-brand" href="#create" onClick={() => { setPage('create'); setNavOpen(false); }} aria-label="찬양 PPT 제작 화면">
            <img src="/logo.png" width="34" height="34" alt="" />
            <span>찬양 PPT</span>
          </a>
          <nav className="nav__links app-links" aria-label="주요 메뉴">
            <a className="nav__link" href="#create" onClick={() => { setPage('create'); setNavOpen(false); }}>PPT 제작</a>
            <a className="nav__link" href="#manage" aria-current={page === 'manage' ? 'page' : undefined} onClick={() => { setPage('manage'); setNavOpen(false); }}>곡 관리</a>
          </nav>
          <div className="nav__actions"><span className={`app-online ${libraryError ? 'is-error' : ''}`}><i aria-hidden="true" />{loadingSongs ? '연결 확인 중' : libraryError ? '연결을 확인해 주세요' : '데이터베이스 연결됨'}</span><span className="auth-account-email">{authUser?.email}</span><button className="btn btn--secondary auth-logout" type="button" onClick={() => void signOut()}>로그아웃</button><a className="btn btn--primary" href="#create">PPT 제작</a></div>
          <button className="nav__toggle" type="button" aria-label={navOpen ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={navOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        </div>
      </header>}

      {page === 'create' ? (
        <main className={`editor-page mobile-view-${mobileEditorView}`} id="create" onPointerDownCapture={(event) => { const target = event.target; if (target instanceof Element && target.closest('.editor-slide-text, .text-box-handle')) return; setSelectedTextSlide(null); }}>
          <nav className="editor-mobile-nav" aria-label="편집 화면">
            <button type="button" aria-pressed={mobileEditorView === 'songs'} onClick={() => setMobileEditorView('songs')}>곡 선택</button>
            <button type="button" aria-pressed={mobileEditorView === 'slides'} onClick={() => setMobileEditorView('slides')} disabled={!activeSong && selected.length === 0}>PPT 미리보기</button>
          </nav>
          <aside className="editor-sidebar" aria-label="찬양 곡 선택">
            <a className="editor-brand" href="#create" aria-label="Yebit 찬양 PPT 제작">
              <img src="/assets/figma/editor-logo.png" width="42" height="42" alt="" />
              <span><strong>Yebit</strong><small>찬양 라이브러리</small></span>
            </a>
            <div ref={searchWidgetRef} className="editor-search-shell" onPointerMove={trackSearchGlassReflection} onPointerLeave={resetSearchGlassReflection}>
              {!searchOpen ? <button className="editor-search-widget" type="button" aria-label="곡 제목 또는 찬송가 번호 검색" onClick={() => setSearchOpen(true)}>
                <span className="editor-search-off"><img src="/assets/figma/search.svg" alt="" /><span>곡 제목 또는 찬송가 번호</span></span>
              </button> : <div className={`editor-search-widget is-active${query.trim() || results.length || searchNotice ? ' has-results' : ''}`}>
                <form className="editor-search" onSubmit={searchSongs}>
                  <label className="visually-hidden" htmlFor="worship-song-search">곡 제목 또는 찬송가 번호</label>
                  <span className="editor-search-input"><img src="/assets/figma/search.svg" alt="" /><input id="worship-song-search" ref={searchInputRef} autoComplete="off" maxLength={120} value={query} onChange={(event) => { setQuery(event.target.value); setSearchNotice(null); setResults([]); }} placeholder="곡 제목 또는 찬송가 번호" /></span>
                  <button className="visually-hidden" type="submit" disabled={!query.trim()}>검색</button>
                </form>
                {(query.trim() || results.length > 0 || searchNotice) && <div className="editor-search-results" aria-live="polite">
                  {results.length > 0 ? <div className="search-result-group">
                    <span>검색 결과</span>
                    {results.map(song => <div className="editor-favorite-row" key={song.id}>
                      <button className="search-result-row" type="button" onClick={() => addSearchResult(song)}>
                        <strong>{song.title}</strong>
                        {displayKnown(song.artist) && <small>{displayKnown(song.artist)}</small>}
                      </button>
                      {song.id > 0 && <button className={`favorite-toggle${favoriteIds.includes(song.id) ? ' is-favorite' : ''}`} type="button"
                        onClick={() => toggleFavorite(song)} aria-label={favoriteIds.includes(song.id) ? `${song.title} 즐겨찾기 해제` : `${song.title} 즐겨찾기 추가`}>
                        {favoriteIds.includes(song.id) ? '★' : '☆'}
                      </button>}
                    </div>)}
                  </div> : searchSuggestions.length > 0 ? <>
                    {searchSuggestions.map((group) => <section className="search-result-group" key={group.label}>
                      <span>{group.label}</span>
                      {group.songs.map((song) => <div className="editor-favorite-row" key={`${group.label}:${song.id}`}>
                        <button className="search-result-row" type="button" onClick={() => addSearchResult(song)}>
                          <strong>{song.title}</strong>
                          <small>{displayKnown(song.artist) || (song.hymnNumber ? `새찬송가 ${song.hymnNumber}장` : '곡 선택 후 PPT 제작')}</small>
                        </button>
                        {song.id > 0 && <button className={`favorite-toggle${favoriteIds.includes(song.id) ? ' is-favorite' : ''}`} type="button"
                          onClick={() => toggleFavorite(song)} aria-label={favoriteIds.includes(song.id) ? `${song.title} 즐겨찾기 해제` : `${song.title} 즐겨찾기 추가`}>
                          {favoriteIds.includes(song.id) ? '★' : '☆'}
                        </button>}
                      </div>)}
                    </section>)}
                    <p className="search-result-hint search-result-hint--footer">원하는 곡이 안 보이나요? 제목을 더 입력하거나 Enter를 눌러 검색해 보세요.</p>
                  </> : <div className="search-no-match">
                    {searchNotice && <p className={`search-result-hint ${searchNotice.kind ?? ''}`}>{searchNotice.text}</p>}
                    <strong>관련 곡 추천이 아직 없습니다</strong>
                    <span>곡이 없다는 뜻은 아니에요. 제목을 더 입력하거나 직접 검색해 보세요.</span>
                    <button type="button" onClick={() => searchInputRef.current?.form?.requestSubmit()} disabled={!query.trim()}>
                      ‘{query.trim()}’로 검색
                    </button>
                  </div>}
                </div>}
              </div>}
            </div>
            <div className="editor-tabs" role="group" aria-label="곡 라이브러리">
              <button type="button" aria-pressed={editorTab === 'songs'} onClick={() => changeEditorTab('songs')}>최근</button>
              <button type="button" aria-pressed={editorTab === 'favorites'} onClick={() => changeEditorTab('favorites')}>즐겨찾기</button>
              <button type="button" aria-pressed={editorTab === 'trending'} onClick={() => changeEditorTab('trending')}>트렌드</button>
            </div>
            <div className="editor-controls">
              {editorTab === 'songs' ? <div className="editor-control-group">
                {editorTab === 'songs' && recentSongs.length > 0 && <section className="recent-song-section" aria-label="최근 곡">
                  <div className="recent-song-list">{recentSongs.slice(0, 5).map((recent) => { const videoId = recent.youtubeVideoId || youtubeVideos.find((video) => video.songId === recent.id)?.videoId; const imageUrl = youtubeThumbnailUrl(videoId); return <div className="recent-song-card-shell" key={`${recent.id}:${recent.title}`} role="button" tabIndex={0} aria-label={`${recent.title} 선택`} onClick={() => void openRecentSong(recent)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void openRecentSong(recent); } }}><div className="recent-song-card">{imageUrl && <img className="recent-song-card__image" src={imageUrl} alt="" />}<span className="recent-song-card__glass"><span className="recent-song-card__title"><strong>{recent.title}</strong></span><span className="recent-song-card__meta"><small>최근 선택 · {new Date(recent.selectedAt).toLocaleDateString('ko-KR')}</small></span></span></div><button className="recent-song-delete" type="button" onClick={(event) => { event.stopPropagation(); setRecentSongs((songs) => songs.filter((song) => recentTitleKey(song.title) !== recentTitleKey(recent.title))); }} aria-label={`${recent.title} 최근 목록에서 삭제`}>×</button></div>; })}</div>
                </section>}
                {editorTab === 'songs' && selected.length > 0 && <section ref={selectedQueueRef} className="editor-selected-queue" aria-labelledby="editor-selected-title"><div className="editor-heading"><h2 id="editor-selected-title">제작 목록</h2><span>{selected.length}곡</span></div><ol className="selected-list">{selected.map((song, index) => <li key={song.id} data-song-id={song.id} draggable onDragStart={(event) => { draggedSongIdRef.current = song.id; originalSongOrderRef.current = selected.map((item) => item.id); setDraggedSongId(song.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(song.id)); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; reorderDraggedSong(song.id, event.clientY, event.currentTarget); }} onDrop={(event) => event.preventDefault()} onDragEnd={() => { if (originalSongOrderRef.current?.some((id, orderIndex) => selected[orderIndex]?.id !== id)) { setRemovedSlideIndexes([]); setSlideOrder([]); setSlidePositions({}); setSlideTextOverrides({}); setSlideTextColors({}); setEditingSlide(null); } draggedSongIdRef.current = null; originalSongOrderRef.current = null; setDraggedSongId(null); }} className={draggedSongId === song.id ? 'is-dragging' : ''} aria-roledescription="끌어서 순서 변경"><span className="selected-drag-handle" aria-hidden="true">⠿</span><span className="selected-index">{String(index + 1).padStart(2, '0')}</span><span className="selected-song"><strong>{song.title}</strong></span><div className="selected-actions"><button type="button" onClick={() => moveSong(index, -1)} disabled={index === 0} aria-label={`${song.title} 위로`}>↑</button><button type="button" onClick={() => moveSong(index, 1)} disabled={index === selected.length - 1} aria-label={`${song.title} 아래로`}>↓</button><button type="button" onClick={() => { setRemovedSlideIndexes([]); setSlideOrder([]); setSelected((items) => items.filter((item) => item.id !== song.id)); }} aria-label={`${song.title} 제거`}>×</button></div></li>)}</ol></section>}
              </div> : editorTab === 'favorites' ? <div className="editor-control-group">
                <div className="editor-heading"><h2>즐겨찾기</h2><span>{favoriteSongs.length}곡</span></div>
                {loadingSongs ? <div className="editor-library-empty"><strong>곡 목록을 확인하고 있습니다</strong></div> : !libraryError && (favoriteSongs.length === 0 ? <div className="editor-library-empty"><strong>즐겨찾는 곡이 없습니다</strong><span>곡 검색 결과에서 별표를 눌러 추가하세요.</span></div> : <div className="editor-favorite-list">{favoriteSongs.map((song) => { const artwork = favoriteArtwork[song.id]; const videoId = youtubeVideos.find((video) => video.songId === song.id)?.videoId; const imageUrl = youtubeThumbnailUrl(videoId) || (artwork?.imageUrl || undefined); const pending = pendingFavoriteRemovals.includes(song.id); return <div className="recent-song-card favorite-artwork-row" key={song.id}>{imageUrl && <img className="recent-song-card__image" src={imageUrl} alt="" />}<span className="recent-song-card__glass favorite-artwork-glass"><button className="recent-song-card__title" type="button" onClick={() => selectSong(song)}><strong>{song.title}</strong></button><span className="recent-song-card__meta"><small>{song.category?.toUpperCase() === 'HYMN' && song.hymnNumber ? `새찬송가 ${song.hymnNumber}장` : displayKnown(song.artist) || '즐겨찾기 곡'}</small></span></span><button className={`favorite-toggle favorite-artwork-toggle${pending ? '' : ' is-favorite'}`} type="button" onClick={() => toggleFavorite(song)} aria-label={pending ? `${song.title} 즐겨찾기 취소` : `${song.title} 즐겨찾기 해제`}>{pending ? '☆' : '★'}</button></div>; })}</div>)}
              </div> : null}
              <div className={`editor-control-group trend-panel${editorTab === 'trending' ? ' is-visible' : ' is-preloaded'}`} aria-hidden={editorTab !== 'trending'}>
                <div className="editor-heading"><h2>찬양 곡</h2><span>{youtubeVideos.length}곡</span></div>
                <p className="trend-source-note">일치한 영상 조회수 기준 상위 30곡 · 주 1회 갱신 · 여러 곡이 담긴 영상은 영상 전체 통계</p>
                {youtubeStatus === 'loading' ? <p className="trend-source-note">곡 정보를 불러오는 중입니다.</p> : youtubeStatus === 'error' ? <p className="trend-source-note">곡 정보를 불러오지 못했습니다.</p> : youtubeVideos.length ? <ul className="local-trend-list">{youtubeVideos.map((video, index) => <li key={video.videoId}><span className="local-trend-rank" aria-label={`${index + 1}번째 곡`}>{index + 1}</span><button type="button" className="local-trend-song" onClick={() => void openTrendingSong(video.songId)}><img className="local-trend-artwork" src={youtubeThumbnailUrl(video.videoId)} alt="" /><span className="local-trend-song__text"><strong>{video.title}</strong></span></button></li>)}</ul> : <div className="editor-library-empty"><strong>일치하는 곡이 없습니다</strong><span>확인된 곡이 있으면 여기에 표시됩니다.</span></div>}
              </div>
            </div>
          </aside>
          <section className="editor-workspace" aria-labelledby="preview-title">
            <div className="editor-toolbar"><div className="editor-toolbar__left"><div className="editor-title-control" ref={titleControlRef}><svg className="editor-title-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M13 14h5m-2-2 2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>{titleEditOpen ? <input className="editor-document-title-input" aria-label="프레젠테이션 제목 편집" style={{width:`${Math.max(1, presentationTitle.length)}em`}} autoFocus value={presentationTitle} onChange={(event) => setPresentationTitle(event.target.value)} maxLength={80} onBlur={() => setTitleEditOpen(false)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); setTitleEditOpen(false); } }} /> : <button className="editor-document-title" type="button" aria-label="프레젠테이션 제목 수정" aria-expanded={titleEditOpen} onClick={() => setTitleEditOpen(true)}><span>{presentationTitle.trim() || '제목 없는 디자인'}</span></button>}</div><div className="editor-size-control" ref={sizeControlRef}><button className="editor-page-count" type="button" aria-label={`슬라이드 크기 ${slideSize.width} 곱하기 ${slideSize.height} 픽셀`} aria-expanded={sizeOpen} onClick={() => setSizeOpen((open) => !open)}><span>{slideSize.width}×{slideSize.height} px</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 7.5 5.5 5 5.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>{sizeOpen && <div className="editor-size-menu"><div className="editor-size-presets">{[{label:'16:9',width:1280,height:720},{label:'16:10',width:1280,height:800},{label:'4:3',width:1280,height:960},{label:'1:1',width:960,height:960}].map((preset) => <button type="button" key={preset.label} aria-pressed={slideSize.width===preset.width&&slideSize.height===preset.height} onClick={() => setSlideSize({width:preset.width,height:preset.height})}>{preset.label}</button>)}</div><div className="editor-size-custom"><label>가로<input type="number" min="320" max="3840" value={slideSize.width} onChange={(event) => setSlideSize((size) => ({...size,width:Math.max(320,Math.min(3840,Number(event.target.value)||320))}))}/></label><span>×</span><label>세로<input type="number" min="320" max="3840" value={slideSize.height} onChange={(event) => setSlideSize((size) => ({...size,height:Math.max(320,Math.min(3840,Number(event.target.value)||320))}))}/></label></div></div>}</div></div>
            <div className="editor-toolbar-account"><button className="editor-toolbar-queue" type="button" onClick={() => { setEditorTab('songs'); window.requestAnimationFrame(() => selectedQueueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); }} aria-label={`제작 목록, ${selected.length}곡 · ${preview?.slideCount ?? 1}장`}>{selected.length}곡 · {preview?.slideCount ?? 1}장</button><button className="btn btn--primary editor-toolbar-export" type="button" onClick={createPpt} disabled={creating}>{creating ? '만드는 중…' : 'PPTX 다운로드'}</button><button className={darkMode ? 'editor-theme-toggle is-dark' : 'editor-theme-toggle'} type="button" aria-label={darkMode ? '라이트 모드로 전환' : '다크 모드로 전환'} aria-pressed={darkMode} title={darkMode ? '라이트 모드' : '다크 모드'} onClick={() => setDarkMode(mode => !mode)}>{darkMode ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.6 8.6 0 1 0 20.2 15.1Z" fill="currentColor"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.4" fill="currentColor"/><path d="M12 2v2.2M12 19.8V22M4.93 4.93l1.56 1.56m11.02 11.02 1.56 1.56M2 12h2.2m15.6 0H22M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>}</button><div className="editor-account-control" ref={accountMenuRef}><button className="editor-account-trigger" type="button" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(open => !open)}><span>{authUser?.email ?? '계정'}</span><span className="editor-account-chevron" aria-hidden="true">⌄</span></button>{accountMenuOpen && <div className="editor-account-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setSettingsOpen(true); }}><span aria-hidden="true">⚙</span> 설정</button><button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); void signOut(); }}><span aria-hidden="true">↪</span> 로그아웃</button></div>}</div></div></div>
            {pptNotice && <p className={`editor-ppt-notice notice ${pptNotice.kind ?? ''}`} role="status" aria-live="polite">{pptNotice.text}</p>}
            {!activeSong && scoreControlSong && <div className="editor-mobile-song-context" aria-label={`현재 선택한 곡 ${scoreControlSong.title}`}>
              <span>선택한 곡</span>
              <strong>{scoreControlSong.title}</strong>
            </div>}
            {activeSong && <section className="editor-ppt-candidate" aria-label="선택한 곡">
              <div className="editor-ppt-candidate__header">
                <strong>{activeSong.title}</strong>
                <div className="editor-ppt-candidate__actions">
                  <button type="button" className="btn btn--primary" disabled={Boolean(candidateAdded) || selected.length >= 100} onClick={() => addOriginalPpt(activeSong)}>
                    {candidateAdded ? '목록에 추가됨' : '곡 목록에 추가'}
                  </button>
                </div>
              </div>
            </section>}
            {statusSong && melodyStatus && <div className="editor-melody-status" role="status">
              <span><strong>{statusSong.title}</strong> · {melodyStatus.message}</span>
              {melodyStatus.state === 'failed' && <button type="button" className="preview-retry" onClick={() => retryMelody(statusSong)}>악보 다시 시도</button>}
            </div>}
            <div className="editor-stage">
              {previewError ? <div className="editor-canvas-message"><strong>미리보기를 열 수 없습니다</strong><span>{previewError}</span><button type="button" className="preview-retry" onClick={() => setPreviewRetry((value) => value + 1)}>다시 시도</button></div> : previewLoading && !prepared ? <div className="editor-canvas-message"><span className="preview-spinner" aria-hidden="true"/><strong>슬라이드를 불러오는 중</strong></div> : <div className="editor-page-stack" onScroll={(event) => { const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-slide-index]')); const middle = event.currentTarget.getBoundingClientRect().top + event.currentTarget.clientHeight / 2; const nearest = cards.reduce((best, card) => Math.abs(card.getBoundingClientRect().top + card.offsetHeight / 2 - middle) < Math.abs(best.getBoundingClientRect().top + best.offsetHeight / 2 - middle) ? card : best, cards[0]); if (nearest) { setPreviewIndex(Number(nearest.dataset.slideIndex)); setSelectedTextSlide(null); } }}>
                {(prepared?.thumbnails ?? []).map((thumbnail, slide) => { const position = slidePositions[slide] ?? prepared?.slides[slide]?.textPosition ?? { x: pptStyle.textX, y: pptStyle.textY, width: pptStyle.textWidth, height: pptStyle.textHeight }; const selectedText = selectedTextSlide === slide; const page = prepared?.slides[slide]; const scoreRows = page?.autoScore && (selectedText || editingSlide === slide || slideTextOverrides[slide] !== undefined) ? undefined : page?.scoreRows; return <div className={`editor-page-sheet ${previewIndex === slide ? 'is-current' : ''}${scoreRows?.length ? ' has-score-rows' : ''}`} data-slide-index={slide} key={displaySlideOrder[slide] ?? slide} style={{aspectRatio:`${slideSize.width} / ${slideSize.height}`}}><img src={`data:image/png;base64,${thumbnail}`} alt="슬라이드 배경"/><div className="editor-slide-text" style={{left:`${position.x-position.width/2}%`,top:`${position.y-position.height/2}%`,width:`${position.width}%`,height:`${position.height}%`,fontFamily:pptStyle.fontFamily,fontSize:`${pptStyle.fontSize/960*100}cqw`,fontWeight:pptStyle.bold?700:400,color:slideTextColors[slide]??pptStyle.textColor,justifyContent:pptStyle.alignment==='LEFT'?'flex-start':pptStyle.alignment==='RIGHT'?'flex-end':'center',lineHeight:1.2}} onClick={() => { if (editingSlide !== slide) { setPreviewIndex(slide); setSelectedTextSlide(slide); } }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setPreviewIndex(slide); setSelectedTextSlide(slide); setEditingSlide(slide); }} onPointerDown={(event) => { if (selectedText && editingSlide !== slide && !(event.target instanceof HTMLTextAreaElement)) startTextBoxInteraction(event, slide, position); }} onPointerMove={moveTextBoxInteraction} onPointerUp={endTextBoxInteraction} onPointerCancel={endTextBoxInteraction} role="button" tabIndex={0} aria-label={`${slide+1}페이지 가사 텍스트 선택`} title="두 번 클릭하여 가사 수정">{editingSlide === slide ? <textarea className="editor-slide-textarea" autoFocus value={slideTextOverrides[slide] ?? prepared?.slides[slide]?.lines.join('\n') ?? ''} onChange={(event) => setSlideTextOverrides((items) => ({ ...items, [slide]: event.target.value }))} onPointerDown={(event) => event.stopPropagation()} onBlur={() => setEditingSlide(null)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setEditingSlide(null); } }} aria-label={`${slide+1}페이지 가사 편집`} /> : <span style={{display:'block',width:'100%',textAlign:pptStyle.alignment.toLowerCase() as CanvasTextAlign}}>{slideTextOverrides[slide] ?? prepared?.slides[slide]?.lines.join('\n')}</span>}</div>{scoreRows?.length ? <ScoreRowsOverlay rows={scoreRows} fontFamily={pptStyle.fontFamily} fontSize={pptStyle.fontSize} color={slideTextColors[slide] ?? pptStyle.textColor} bold={pptStyle.bold} onSelect={page?.autoScore ? () => { setPreviewIndex(slide); setSelectedTextSlide(slide); } : undefined} /> : null}{selectedText && !scoreRows?.length && <div className="text-box-selection" style={{left:`${position.x-position.width/2}%`,top:`${position.y-position.height/2}%`,width:`${position.width}%`,height:`${position.height}%`}} onPointerMove={moveTextBoxInteraction} onPointerUp={endTextBoxInteraction} onPointerCancel={endTextBoxInteraction} role="group" aria-label="가사 상자 위치와 크기 조절"><i className="text-box-handle text-box-handle--tl"/><i className="text-box-handle text-box-handle--tr"/><i className="text-box-handle text-box-handle--bl"/><button className="text-box-handle text-box-handle--br" type="button" aria-label="가사 상자 크기 조절" onPointerDown={(event) => startTextBoxInteraction(event, slide, position, 'resize')} onPointerMove={moveTextBoxInteraction} onPointerUp={endTextBoxInteraction} onPointerCancel={endTextBoxInteraction}/></div>}<span className="editor-page-label">{slide + 1} 페이지</span><button className="editor-page-delete" type="button" aria-label={`${slide + 1}페이지 삭제`} onClick={() => removeSlide(slide)}>×</button></div>; })}
              </div>}
            </div>
            <div className="editor-filmstrip" aria-label="슬라이드 페이지">
              {Array.from({ length: preview?.slideCount ?? 0 }, (_, slide) => {
                const position = slidePositions[slide] ?? prepared?.slides[slide]?.textPosition ?? { x: 50, y: 50, width: 60, height: 25 };
                return <div className={`filmstrip-page-shell ${preview?.slideIndex === slide ? 'is-active' : ''}${draggedSlideIndex === slide ? ' is-dragging' : ''}${dropSlideIndex === slide ? ' is-drop-target' : ''}`} key={displaySlideOrder[slide] ?? slide} draggable={Boolean(preview)} onDragStart={(event) => { if ((event.target as HTMLElement).closest('.filmstrip-page-delete')) { event.preventDefault(); return; } draggedSlideIndexRef.current = slide; setDraggedSlideIndex(slide); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(slide)); const ghost = event.currentTarget.cloneNode(true) as HTMLElement; ghost.classList.remove('is-dragging', 'is-drop-target'); ghost.style.position = 'fixed'; ghost.style.left = '-10000px'; ghost.style.top = '0'; ghost.style.opacity = '1'; ghost.style.pointerEvents = 'none'; document.body.append(ghost); event.dataTransfer.setDragImage(ghost, Math.min(event.nativeEvent.offsetX, ghost.offsetWidth), Math.min(event.nativeEvent.offsetY, ghost.offsetHeight)); requestAnimationFrame(() => ghost.remove()); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (draggedSlideIndexRef.current !== null) setDropSlideIndex(slide); }} onDrop={(event) => { event.preventDefault(); const from = draggedSlideIndexRef.current; if (from !== null) reorderSlides(from, slide); draggedSlideIndexRef.current = null; setDraggedSlideIndex(null); setDropSlideIndex(null); }} onDragEnd={() => { draggedSlideIndexRef.current = null; setDraggedSlideIndex(null); setDropSlideIndex(null); }} aria-roledescription="끌어서 순서 변경" title="끌어서 슬라이드 순서 변경">
                  <button className="filmstrip-page" type="button" onClick={() => { setPreviewIndex(slide); document.querySelector<HTMLElement>(`[data-slide-index="${slide}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} disabled={!preview} aria-label={`${slide + 1}번 슬라이드 미리보기 · 끌어서 순서 변경`} aria-current={preview?.slideIndex === slide ? 'page' : undefined}>
                    <span className={`filmstrip-canvas${prepared?.slides[slide]?.scoreRows?.length ? ' has-score-rows' : ''}`}>{prepared?.thumbnails[slide] && <img src={`data:image/png;base64,${prepared.thumbnails[slide]}`} alt="" />}<span className="filmstrip-lyrics" style={{left:`${position.x-position.width/2}%`,top:`${position.y-position.height/2}%`,width:`${position.width}%`,height:`${position.height}%`,fontFamily:pptStyle.fontFamily,fontSize:`${pptStyle.fontSize/960*100}cqw`,fontWeight:pptStyle.bold?700:400,color:slideTextColors[slide]??pptStyle.textColor,textAlign:pptStyle.alignment.toLowerCase() as CanvasTextAlign}}>{slideTextOverrides[slide] ?? prepared?.slides[slide]?.lines.join('\n')}</span>{prepared?.slides[slide]?.scoreRows?.length ? <span className="filmstrip-score">{prepared.slides[slide].scoreRows.map((row, rowIndex) => <span key={rowIndex}>{row.staff && <img src={row.staff} alt="" />}<small>{row.lyrics}</small></span>)}</span> : null}</span><span className="filmstrip-number">{slide + 1}</span>
                  </button>
                  <button className="filmstrip-page-delete" type="button" onClick={() => removeSlide(slide)} aria-label={`${slide + 1}번 슬라이드 삭제`}>×</button>
                </div>;
              })}
              <button className="filmstrip-add" type="button" onClick={() => { const nextIndex = preview?.slideCount ?? 1; setExtraSlideCount((count) => count + 1); setPreviewIndex(nextIndex); }} aria-label="페이지 추가"><span aria-hidden="true">＋</span><small>페이지 추가</small></button>
            </div>
          </section>

        </main>
      ) : (
        <main className="manage-page" id="manage">
          <section className="workspace-head manage-head">
            <div><p className="eyebrow">라이브러리 관리</p><h1>곡 관리</h1><p className="lead">등록된 곡과 가사 가져오기를 관리합니다.</p></div>
            <button className="btn btn--secondary" onClick={() => void loadSongs()}>목록 새로고침</button>
          </section>
          <section className="manage-grid">
            <section className="panel manage-library" aria-labelledby="manage-songs-title">
              <div className="panel-heading"><div><span className="step-number">01</span><h2 id="manage-songs-title">등록된 곡</h2></div><span className="small-stat">{allSongs.length}곡</span></div>
              <p className="manage-description">가사가 없는 곡은 이 관리 화면에서만 확인할 수 있습니다. PPT 제작 검색에는 포함되지 않습니다.</p>
              <label className="field"><span className="visually-hidden">등록 곡 검색</span><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="제목 또는 작사가 검색" /></label>
              {loadingSongs ? <div className="empty-state">목록을 불러오는 중입니다.</div> : libraryError ? <div className="empty-state empty-state--error">{libraryError}</div> : <div className="management-list">
                {allSongs.filter((song) => `${song.title}${song.author ?? ''}`.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, '').includes(libraryQuery.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ''))).slice(0, 100).map((song) => <div className="management-row" key={song.id}>
                  <div><strong>{song.title}</strong><small>{song.category?.toUpperCase() === 'HYMN' && song.hymnNumber ? `새찬송가 ${song.hymnNumber}장` : song.category ?? '분류 없음'} · 작사 {displayPerson(song.author)}</small></div>
                  <span className={`status-label ${song.status === 'USER_SUPPLIED' ? 'status-label--ready' : ''}`}>{song.status === 'USER_SUPPLIED' ? '가사 등록' : '가사 없음'}</span>
                </div>)}
              </div>}
            </section>
            <div className="manage-column">
              <section className="panel import-panel" aria-labelledby="import-title">
                <div className="panel-heading"><div><span className="step-number">02</span><h2 id="import-title">가사 파일 가져오기</h2></div></div>
                <p className="manage-description">TXT, CSV, JSON, PPTX 파일을 가져옵니다. 곡 제목이 일치하고 가사가 비어 있는 항목에 저장됩니다.</p>
                <label className="file-field import-file"><span>파일 선택</span><input type="file" multiple accept=".txt,.csv,.json,.pptx" onChange={importFiles} /><small>최대 50개 · 전체 8MB까지</small></label>
                {importNotice && <p className={`notice ${importNotice.kind ?? ''}`} role="status">{importNotice.text}</p>}
                {importing && <div className="loading-line" aria-label="가사 파일을 가져오는 중" />}
              </section>
              <section className="panel request-panel" aria-labelledby="requests-title">
                <div className="panel-heading"><div><span className="step-number">03</span><h2 id="requests-title">추가할 곡 대기열</h2></div></div>
                <p className="manage-description">검색한 곡이 준비되지 않은 경우 이곳에 요청이 기록됩니다.</p>
                <form className="request-search" onSubmit={(event) => { event.preventDefault(); void loadRequests(); }}><label className="field"><span className="visually-hidden">요청 검색</span><input value={requestQuery} onChange={(event) => setRequestQuery(event.target.value)} placeholder="곡 제목 또는 작사가" /></label><button className="btn btn--secondary" type="submit">조회</button></form>
                {requestNotice && <p className={`notice ${requestNotice.kind ?? ''}`} role="status">{requestNotice.text}</p>}
                <div className="requests-list">{requests.length === 0 ? <div className="empty-state">대기 중인 곡이 없습니다.</div> : requests.map((request) => <div className="request-row" key={request.id}>
                  <div><strong>{request.title}</strong><small>작사 {displayPerson(request.lyricist)} · 요청 {request.count}회</small></div>
                  <label className="link-request"><span className="visually-hidden">연결할 곡 선택</span><select defaultValue="" onChange={(event) => { if (event.target.value) void completeRequest(request, Number(event.target.value)); }}><option value="">연결할 곡</option>{allSongs.map((song) => <option key={song.id} value={song.id}>{song.title} · ID {song.id}</option>)}</select></label>
                </div>)}</div>
              </section>
            </div>
          </section>
        </main>
      )}
      {settingsOpen && <div className="account-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="account-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
          <header><div><p>계정 설정</p><h2 id="account-settings-title">화면 설정</h2></div><button type="button" aria-label="설정 닫기" onClick={() => setSettingsOpen(false)}>×</button></header>
          <div className="account-settings-account"><span>로그인 계정</span><strong>{authUser?.email ?? "계정 정보 없음"}</strong><small>화면 밝기는 상단의 해·달 버튼으로 바로 바꿀 수 있습니다.</small></div>
        </section>
      </div>}
      {page === 'manage' && <footer className="app-footer closing"><span>찬양 PPT</span><span>예배 자료 제작 도구</span><a className="link" href="#create">PPT 제작</a></footer>}
    </>
  );
}
