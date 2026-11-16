import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { api, cloudflareMode } from './api';
import type { Song, SongRequest } from './types';
import { collectSlides, renderSlide, type Slide, type SlideSize, type SlideStyle, type SlideTextPosition } from './presentation';

type Notice = { text: string; kind?: 'error' | 'success' } | null;
type RecentSong = { id: number; title: string; artist: string | null; selectedAt: number; lyrics?: string; source?: string | null; youtubeVideoId?: string; artworkUrl?: string; artworkSourceUrl?: string; artworkContributor?: string };
type FavoriteArtwork = { imageUrl: string; sourceUrl?: string; contributor?: string };
type PptStyle = {
  backgroundColor: string; textColor: string; fontFamily: string; fontSize: number;
  alignment: 'LEFT' | 'CENTER' | 'RIGHT'; linesPerSlide: number; bold: boolean;
  textX: number; textY: number; textWidth: number; textHeight: number;
};
type Preview = { imageBase64: string; slideIndex: number; slideCount: number };
type PptPayload = { slideSize?: SlideSize; songIds: number[]; extraSlides?: number; removedSlideIndexes?: number[]; slidePositions?: Record<number, SlideTextPosition>; slideTextOverrides?: Record<number, string>; slideTextColors?: Record<number, string>; externalSongs?: { id: number; title: string; artist: string | null; lyrics: string }[]; pptxBase64?: string; style: PptStyle & { backgroundImageBase64?: string; backgroundImageType?: string } };

function recentTitleKey(title: string) {
  return title.normalize('NFC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
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

const fontOptions = ['Apple SD Gothic Neo', '맑은 고딕 (Malgun Gothic)', 'Pretendard', 'Noto Sans KR', '나눔고딕 (NanumGothic)', 'Noto Serif KR'];

const templateStyles: Record<string, PptStyle> = {
  original: { backgroundColor: '#16233a', textColor: '#ffffff', fontFamily: 'Apple SD Gothic Neo', fontSize: 40, alignment: 'CENTER', linesPerSlide: 2, bold: false, textX: 50, textY: 50, textWidth: 87.5, textHeight: 55.6 },
  sky: { backgroundColor: '#dff1ff', textColor: '#173149', fontFamily: 'Apple SD Gothic Neo', fontSize: 40, alignment: 'CENTER', linesPerSlide: 2, bold: false, textX: 50, textY: 50, textWidth: 87.5, textHeight: 55.6 },
  white: { backgroundColor: '#ffffff', textColor: '#171717', fontFamily: 'Apple SD Gothic Neo', fontSize: 40, alignment: 'CENTER', linesPerSlide: 2, bold: false, textX: 50, textY: 50, textWidth: 87.5, textHeight: 55.6 },
  black: { backgroundColor: '#000000', textColor: '#ffffff', fontFamily: 'Apple SD Gothic Neo', fontSize: 40, alignment: 'CENTER', linesPerSlide: 2, bold: false, textX: 50, textY: 50, textWidth: 87.5, textHeight: 55.6 },
};

function displayPerson(value?: string | null) {
  return value?.trim() || '정보 없음';
}

function displayKnown(value?: string | null) {
  const text = value?.trim() ?? '';
  return /^(미확인|미확인한 곡|정보 없음|unknown)$/i.test(text) ? '' : text;
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
  const [page, setPage] = useState<'create' | 'manage'>(window.location.hash === '#manage' ? 'manage' : 'create');
  const [navOpen, setNavOpen] = useState(false);
  const [inspectorDock, setInspectorDock] = useState<'left' | 'right'>(() => localStorage.getItem('yebit-inspector-dock') === 'left' ? 'left' : 'right');
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => localStorage.getItem('yebit-inspector-collapsed') === 'true');
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const savedWidth = Number(localStorage.getItem('yebit-inspector-width'));
    return Number.isFinite(savedWidth) && savedWidth >= 240 && savedWidth <= 520 ? savedWidth : 300;
  });
  const inspectorResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; dock: 'left' | 'right' } | null>(null);
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

  useEffect(() => { localStorage.setItem('yebit-inspector-width', String(inspectorWidth)); }, [inspectorWidth]);
  useEffect(() => { localStorage.setItem('yebit-inspector-dock', inspectorDock); }, [inspectorDock]);
  useEffect(() => { localStorage.setItem('yebit-inspector-collapsed', String(inspectorCollapsed)); }, [inspectorCollapsed]);

  function startInspectorResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    inspectorResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: inspectorWidth, dock: inspectorDock };
  }

  function resizeInspector(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = inspectorResizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const direction = drag.dock === 'left' ? 1 : -1;
    setInspectorWidth(Math.max(240, Math.min(520, drag.startWidth + (event.clientX - drag.startX) * direction)));
  }

  function stopInspectorResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (inspectorResizeRef.current?.pointerId !== event.pointerId) return;
    inspectorResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const artworkAttempts = useRef(new Set<string>());
  const artworkQueue = useRef<(Pick<Song, 'id' | 'title'> & { artist?: string | null })[]>([]);
  const activeArtworkRequests = useRef(0);
  const createPptShortcut = useRef<() => void>(() => undefined);
  const addSelectionShortcut = useRef<(song: Song) => void>(() => undefined);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [selected, setSelected] = useState<Song[]>([]);
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [showLyricsTab, setShowLyricsTab] = useState(false);
  const [lyricsLoadingSongId, setLyricsLoadingSongId] = useState<number | null>(null);
  const [lyricsLoadError, setLyricsLoadError] = useState<{ songId: number; message: string } | null>(null);
  const [searchNotice, setSearchNotice] = useState<Notice>(null);
  const [pptNotice, setPptNotice] = useState<Notice>(null);
  const [searching, setSearching] = useState(false);
  const [providerInfo, setProviderInfo] = useState<{ title: string; artist: string; source: string; videoId?: string; url?: string; lyrics?: string }[]>([]);
  const [externalResults, setExternalResults] = useState<Song[]>([]);
  const [creating, setCreating] = useState(false);
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [requestQuery, setRequestQuery] = useState('');
  const [requestNotice, setRequestNotice] = useState<Notice>(null);
  const [importNotice, setImportNotice] = useState<Notice>(null);
  const [importing, setImporting] = useState(false);
  const [existingPpt, setExistingPpt] = useState<File | null>(null);
  const [existingPptData, setExistingPptData] = useState<string | null>(null);
  const [existingPptError, setExistingPptError] = useState('');
  const [pptStyle, setPptStyle] = useState<PptStyle>(templateStyles.original);
  const [template, setTemplate] = useState('original');
  const [backgroundImage, setBackgroundImage] = useState<{ dataUrl: string; type: 'PNG' | 'JPEG'; name: string } | null>(null);
  const [imageInputKey, setImageInputKey] = useState(0);
  const [libraryError, setLibraryError] = useState('');
  const [editorTab, setEditorTab] = useState<'songs' | 'lyrics' | 'favorites' | 'trending'>('songs');
  const [youtubeVideos, setYoutubeVideos] = useState<{ videoId: string; songId: number; title: string; artworkUrl: string | null }[]>([]);
  const [youtubeStatus, setYoutubeStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [recentSongs, setRecentSongs] = useState<RecentSong[]>(() => {
    try {
      const stored = window.localStorage.getItem('yebit.recent-songs');
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? uniqueRecentSongs(parsed.filter((song): song is RecentSong => song && Number.isInteger(song.id) && song.id !== 0 && typeof song.title === 'string' && typeof song.selectedAt === 'number')).slice(0, 5) : [];
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
  const [slideSize, setSlideSize] = useState<SlideSize>({ width:1280, height:720 });
  const [sizeOpen, setSizeOpen] = useState(false);
  const [fontQuery, setFontQuery] = useState('');
  const [fontListOpen, setFontListOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [extraSlideCount, setExtraSlideCount] = useState(0);
  const [removedSlideIndexes, setRemovedSlideIndexes] = useState<number[]>([]);
  const [slidePositions, setSlidePositions] = useState<Record<number, SlideTextPosition>>({});
  const [slideTextOverrides, setSlideTextOverrides] = useState<Record<number, string>>({});
  const [slideTextColors, setSlideTextColors] = useState<Record<number, string>>({});
  const [selectedTextSlide, setSelectedTextSlide] = useState<number | null>(null);
  const [editingSlide, setEditingSlide] = useState<number | null>(null);
  const [prepared, setPrepared] = useState<{ slides: Slide[]; style: SlideStyle; thumbnails: string[]; slideSize: SlideSize } | null>(null);
  const previewCache = useRef(new Map<number, string>());
  const textBoxInteraction = useRef<{ mode: 'move' | 'resize'; slide: number; startX: number; startY: number; x: number; y: number; width: number; height: number; element: HTMLDivElement; bounds: DOMRect } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewRetry, setPreviewRetry] = useState(0);

  const validStyle = Boolean(pptStyle.fontFamily.trim()) && pptStyle.fontFamily.length <= 80 && Number.isInteger(pptStyle.fontSize) && pptStyle.fontSize >= 16 && pptStyle.fontSize <= 100 && Number.isInteger(pptStyle.linesPerSlide) && pptStyle.linesPerSlide >= 1 && pptStyle.linesPerSlide <= 6;
  const favoriteSongs = readySongs.filter((song) => favoriteIds.includes(song.id));
  useEffect(() => {
    if (activeSong) {
      setShowLyricsTab(true);
      return;
    }
    const timeout = window.setTimeout(() => setShowLyricsTab(false), 280);
    return () => window.clearTimeout(timeout);
  }, [activeSong]);
  useEffect(() => {
    let cancelled = false;
    api<typeof youtubeVideos>('/youtube-videos').then(({ data }) => { if (!cancelled) { setYoutubeVideos(data); setYoutubeStatus('ready'); } }).catch(() => { if (!cancelled) setYoutubeStatus('error'); });
    return () => { cancelled = true; };
  }, []);

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
    for (const recent of recentSongs) {
      const videoId = recent.youtubeVideoId || youtubeVideos.find((video) => video.songId === recent.id)?.videoId;
      if (!videoId) requestSongArtwork(recent);
    }
  }, [recentSongs, youtubeVideos]);

  useEffect(() => {
    for (const song of favoriteSongs) {
      const hasYoutubeThumbnail = youtubeVideos.some((video) => video.songId === song.id);
      if (!hasYoutubeThumbnail) requestSongArtwork(song);
    }
  }, [favoriteSongs, favoriteArtwork, youtubeVideos]);

  useEffect(() => {
    for (const song of youtubeVideos) {
      if (song.songId > 0 && !favoriteArtwork[song.songId] && !song.artworkUrl) {
        requestSongArtwork({ id: song.songId, title: song.title });
      }
    }
  }, [youtubeVideos, favoriteArtwork]);

  function selectSong(song: Song, closeSearch = true, trendingVideoId?: string) {
    setActiveSong(song);
    setLyricsLoadError(null);
    if (song.id > 0) setSongSelectionCounts((counts) => ({ ...counts, [song.id]: (counts[song.id] ?? 0) + 1 }));
    if (cloudflareMode && song.id > 0 && !song.lyrics) {
      setLyricsLoadingSongId(song.id);
      void api<Song>('/song-lyrics', { id: song.id, videoId: trendingVideoId }).then(({ data }) => {
        if (data.id < 0) setExternalResults((songs) => [data, ...songs.filter((item) => item.id !== data.id)]);
        setActiveSong((current) => current?.id === song.id ? data : current);
      }).catch((error: unknown) => {
        setLyricsLoadError({
          songId: song.id,
          message: error instanceof Error ? error.message : '가사를 불러오지 못했습니다.',
        });
      }).finally(() => {
        setLyricsLoadingSongId(null);
      });
    }
    changeEditorTab('lyrics');
    if (closeSearch) setSearchOpen(false);
    artworkAttempts.current.delete(`${song.id}:${song.title}`);
    const matchedVideoId = trendingVideoId || youtubeVideoIdFromUrl(song.source)
      || youtubeVideos.find((video) => video.songId === song.id)?.videoId;
    const thumbnailUrl = youtubeThumbnailUrl(matchedVideoId);
    if (thumbnailUrl && song.id > 0) {
      setFavoriteArtwork((items) => ({ ...items, [song.id]: { imageUrl: thumbnailUrl } }));
    }
    const titleKey = recentTitleKey(song.title);
    setRecentSongs((songs) => uniqueRecentSongs([
      { ...songs.find((recent) => recentTitleKey(recent.title) === titleKey), id: song.id, title: song.title, artist: song.artist, selectedAt: Date.now(), ...(matchedVideoId ? { youtubeVideoId: matchedVideoId, artworkUrl: thumbnailUrl, artworkSourceUrl: undefined, artworkContributor: undefined } : {}), ...(song.id < 0 && song.lyrics ? { lyrics: song.lyrics, source: song.source } : {}) },
      ...songs.filter((recent) => recentTitleKey(recent.title) !== titleKey),
    ]).slice(0, 5));
  }

  async function openTrendingSong(songId: number) {
    const trendingVideoId = youtubeVideos.find((video) => video.songId === songId)?.videoId;
    const loadedSong = readySongs.find((song) => song.id === songId) ?? allSongs.find((song) => song.id === songId);
    if (loadedSong) {
      selectSong(loadedSong, true, trendingVideoId);
      return;
    }

    try {
      const response = await api<Song[]>('/songs');
      setAllSongs(response.data);
      const song = response.data.find((item) => item.id === songId);
      if (song) selectSong(song, true, trendingVideoId);
      else setEditorTab('songs');
    } catch {
      setEditorTab('songs');
    }
  }

  async function openRecentSong(recent: RecentSong) {
    const loadedSong = readySongs.find((song) => song.id === recent.id) ?? allSongs.find((song) => song.id === recent.id);
    if (loadedSong) { selectSong(loadedSong); return; }
    if (recent.id > 0) {
      try {
        const response = await api<Song>('/song-lyrics', { id: recent.id });
        selectSong(response.data);
        return;
      } catch {
        setPptNotice({ text: '최근 선택한 곡을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', kind: 'error' });
        return;
      }
    }
    if (recent.id < 0 && recent.lyrics?.trim()) {
      selectSong({ id: recent.id, title: recent.title, artist: recent.artist, author: null, composer: null,
        category: null, hymnNumber: null, status: 'USER_SUPPLIED', source: recent.source, lyrics: recent.lyrics });
      return;
    }
    const externalSong = externalResults.find((song) => song.id === recent.id && song.title === recent.title)
      ?? externalResults.find((song) => song.id === recent.id);
    if (externalSong) selectSong(externalSong);
    else if (recent.id < 0) {
      try {
        const response = await api<{ candidates: { title: string; artist: string; url?: string; lyrics?: string }[] }>('/providers/search', { title: recent.title });
        const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const title = normalize(recent.title);
        const recovered = response.data.candidates
          .filter((candidate) => candidate.lyrics?.trim())
          .map((candidate) => ({ candidate, normalized: normalize(candidate.title) }))
          .filter(({ normalized }) => normalized.includes(title) || title.includes(normalized))
          .sort((left, right) => right.candidate.lyrics!.length - left.candidate.lyrics!.length)[0]?.candidate;
        if (!recovered?.lyrics) throw new Error('최근 곡의 가사를 다시 찾지 못했습니다. 곡을 검색해 주세요.');
        selectSong({ id: recent.id, title: recent.title, artist: recent.artist || recovered.artist, author: null, composer: null,
          category: null, hymnNumber: null, status: 'USER_SUPPLIED', source: recovered.url, lyrics: recovered.lyrics });
      } catch (error) {
        setPptNotice({ text: error instanceof Error ? error.message : '최근 곡을 다시 불러오지 못했습니다.', kind: 'error' });
      }
    } else setPptNotice({ text: '최근 선택한 곡을 다시 불러오지 못했습니다.', kind: 'error' });
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

  function changeEditorTab(tab: 'songs' | 'lyrics' | 'favorites' | 'trending') {
    if (editorTab === 'lyrics' && tab !== 'lyrics') setActiveSong(null);
    if (editorTab === 'favorites' && tab !== 'favorites' && pendingFavoriteRemovals.length) {
      setFavoriteIds((ids) => ids.filter((id) => !pendingFavoriteRemovals.includes(id)));
      setPendingFavoriteRemovals([]);
    }
    setEditorTab(tab);
  }

  function presentationPayload(): PptPayload {
    return {
      slideSize,
      songIds: selected.map((song) => song.id),
      extraSlides: extraSlideCount,
      removedSlideIndexes,
      slidePositions,
      slideTextOverrides,
      slideTextColors,
      externalSongs: selected.filter((song) => song.id < 0).map((song) => ({ id: song.id, title: song.title, artist: song.artist, lyrics: song.lyrics ?? '' })),
      ...(existingPptData ? { pptxBase64: existingPptData } : {}),
      style: { ...pptStyle, ...(backgroundImage ? { backgroundImageBase64: backgroundImage.dataUrl.split(',')[1], backgroundImageType: backgroundImage.type } : {}) },
    };
  }

  useEffect(() => {
    setExistingPptData(null);
    setExistingPptError('');
    if (!existingPpt) return;
    const reader = new FileReader();
    reader.onload = () => setExistingPptData(String(reader.result).split(',')[1]);
    reader.onerror = () => setExistingPptError('기존 PPTX 파일을 읽지 못했습니다.');
    reader.readAsDataURL(existingPpt);
    return () => { if (reader.readyState === FileReader.LOADING) reader.abort(); };
  }, [existingPpt]);

  useEffect(() => {
    const controller = new AbortController();
    if (!validStyle) { setPreviewLoading(false); setPreviewError('글꼴과 글자 크기, 줄 수를 확인해 주세요.'); return; }
    if (existingPpt && (!existingPpt.name.toLowerCase().endsWith('.pptx') || existingPpt.size > 20_000_000)) {
      setPreviewLoading(false); setPreviewError('20MB 이하의 PPTX 파일을 선택해 주세요.'); return;
    }
    if (existingPptError) { setPreviewLoading(false); setPreviewError(existingPptError); return; }
    if (existingPpt && !existingPptData) { setPreviewLoading(true); return; }
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
  }, [selected, pptStyle, backgroundImage, slideSize, existingPpt, existingPptData, existingPptError, validStyle, previewRetry, extraSlideCount, removedSlideIndexes, slideTextColors]);

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
    function syncPage() {
      setPage(window.location.hash === '#manage' ? 'manage' : 'create');
    }
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setNavOpen(false); setSearchOpen(false); }
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
    void loadSongs();
    void loadRequests();
  }, []);

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

  async function searchSongs(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setResults([]); setExternalResults([]); setProviderInfo([]); setActiveSong(null); setSearchNotice(null);
    const messages: string[] = [];
    try {
      if (cloudflareMode && /^\d{1,3}$/.test(query.trim())) {
        try {
          const local = await api<Song[]>('/search', { title: query.trim() });
          setResults(local.data);
          if (local.data.length === 1) selectSong(local.data[0], false);
          setSearchNotice({ text: local.data.length ? `찬송가 ${local.data.length}곡을 찾았습니다` : '찬송가를 찾지 못해 대기열에 기록했습니다' });
          if (!local.data.length) await loadRequests();
        } catch { setSearchNotice({ text: '찬송가를 불러오지 못했습니다.', kind: 'error' }); }
        return;
      }
      let localSongs: Song[] = [];
      try {
        const local = await api<Song[]>('/search', { title: query.trim() });
        localSongs = local.data;
        setResults(localSongs);
        messages.push(`내 DB: 가사 ${localSongs.length}곡`);
        if (localSongs.length === 1) selectSong(localSongs[0], false);
        if (!localSongs.length) {
          if (cloudflareMode && !local.headers.has('X-Request-Count')) messages.push('저장된 가사를 찾지 못했습니다');
          else { messages.push('곡 추가 대기열에 기록했습니다'); await loadRequests(); }
        }
      } catch { messages.push('내 DB: 조회 실패'); }
      let found: Song[] = [];
      try {
        const headers = { 'X-User-Agent': 'WorshipPPT/1.0 (https://github.com/ryuyejun/worship-ppt-poc)' };
        const fetchLrclib = async (key: 'track_name' | 'artist_name' | 'q', value: string) => {
          const url = new URL('https://lrclib.net/api/search');
          url.searchParams.set(key, value);
          const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error('요청 실패');
          return await response.json() as { id: number; trackName: string; artistName: string; albumName: string; plainLyrics: string | null; syncedLyrics: string | null }[];
        };
        const original = query.trim().normalize('NFC');
        const corrected = original.replace(/하나님(?=\s|$)/g, '하나님의');
        const searches = [fetchLrclib('track_name', original), fetchLrclib('artist_name', original), fetchLrclib('q', original)];
        if (corrected !== original) searches.push(fetchLrclib('q', corrected));
        const responses = await Promise.allSettled(searches);
        const successful = responses.filter((response): response is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchLrclib>>> => response.status === 'fulfilled');
        if (!successful.length) throw new Error('요청 실패');
        const records = successful.flatMap((response) => response.value);
        const unique = new Set<string>();
        found = records.filter((record) => {
          if (!record.plainLyrics?.trim() && !record.syncedLyrics?.trim()) return false;
          const key = [record.trackName, record.artistName].map((value) => (value || '').normalize('NFC').toLowerCase().replace(/\s+/g, '')).join('|');
          if (unique.has(key)) return false;
          unique.add(key); return true;
        }).map((record) => ({
          id: -record.id, title: record.trackName, author: null, composer: null, artist: record.artistName,
          status: 'USER_SUPPLIED', category: null, hymnNumber: null, source: 'https://lrclib.net', album: record.albumName,
          lyrics: (record.plainLyrics || record.syncedLyrics?.replace(/^\[\d{2}:\d{2}(?:\.\d+)?\]\s*/gm, '') || '').trim(),
        }));
        messages.push(`LRCLIB: 가사 ${found.length}곡`);
      } catch { messages.push('LRCLIB: 연결 실패'); }
      const normalizeSearchTitle = (value: string) => value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const localKeys = new Set(localSongs.map((song) => `${normalizeSearchTitle(song.title)}|${normalizeSearchTitle(song.artist || '')}`));
      found = found.filter((song) => !localKeys.has(`${normalizeSearchTitle(song.title)}|${normalizeSearchTitle(song.artist || '')}`));
      setExternalResults(found);
      try {
        const providers = await api<{ candidates: { title: string; artist: string; source: string; videoId?: string; url?: string; lyrics?: string }[]; status: string[] }>('/providers/search', { title: query.trim() });
        const knownTitles = [...found, ...localSongs].map((song) => normalizeSearchTitle(song.title)).filter((title) => title.length >= 3);
        const uniqueVideoTitles = new Set<string>();
        const videos = providers.data.candidates.filter((candidate) => {
          const title = normalizeSearchTitle(candidate.title);
          if (!candidate.lyrics?.trim() || !title || uniqueVideoTitles.has(title) || knownTitles.some((known) => title.includes(known))) return false;
          uniqueVideoTitles.add(title);
          return true;
        });
        setProviderInfo(videos);
        messages.push(...providers.data.status, `중복 제외 후 ${videos.length}개 표시`);
      } catch { messages.push('곡 목록 또는 YouTube 검색을 불러오지 못했습니다'); }
      setSearchNotice({ text: messages.join(' · ') });
    } finally { setSearching(false); }
  }

  const normalizedLiveQuery = query.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, '');
  const liveSongMatches = normalizedLiveQuery ? readySongs.filter((song) => [song.title, song.author, song.artist, song.composer, song.hymnNumber?.toString()]
    .filter(Boolean).join(' ').normalize('NFC').toLocaleLowerCase().replace(/\s+/g, '').includes(normalizedLiveQuery))
    .sort((a, b) => Number(b.hymnNumber?.toString() === normalizedLiveQuery) - Number(a.hymnNumber?.toString() === normalizedLiveQuery)).slice(0, 6) : [];
  const additionalLiveSongMatches = liveSongMatches.filter((song) => !results.some((result) => result.id === song.id));

  function addSelection(song: Song) {
    if (song.status !== 'USER_SUPPLIED' || (song.lyrics != null && !song.lyrics.trim())) {
      setPptNotice({ text: '가사가 저장된 곡만 PPT에 추가할 수 있습니다.', kind: 'error' });
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
    setRemovedSlideIndexes([]); setSlidePositions({}); setSlideTextOverrides({}); setSlideTextColors({}); setEditingSlide(null);
    setSelected((items) => [...items, song]);
    setPptNotice({ text: 'PPT 제작 목록에 추가했습니다.', kind: 'success' });
  }

  addSelectionShortcut.current = addSelection;

  function moveSong(index: number, delta: number) {
    setRemovedSlideIndexes([]); setSlidePositions({}); setSlideTextOverrides({}); setSlideTextColors({}); setEditingSlide(null);
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
    let originalIndex = 0;
    let visibleCount = 0;
    while (visibleCount < visibleIndex) {
      if (!removedSlideIndexes.includes(originalIndex)) visibleCount += 1;
      originalIndex += 1;
    }
    while (removedSlideIndexes.includes(originalIndex)) originalIndex += 1;
    setRemovedSlideIndexes((indexes) => [...indexes, originalIndex]);
    setSlideTextOverrides({});
    setSlidePositions({});
    setSlideTextColors({});
    setPreviewIndex(Math.max(0, visibleIndex - 1));
    setSelectedTextSlide(null);
    setEditingSlide(null);
  }

  function updateStyle(change: Partial<PptStyle>) {
    setPptStyle((current) => ({ ...current, ...change }));
    setTemplate('custom');
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

  function chooseBackground(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5_000_000 || file.size === 0) {
      setPptNotice({ text: '배경 이미지는 5MB 이하의 PNG 또는 JPEG 파일을 선택해 주세요.', kind: 'error' });
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setPptNotice({ text: '배경 이미지를 읽지 못했습니다.', kind: 'error' });
    reader.onload = () => {
      setBackgroundImage({ dataUrl: String(reader.result), type: file.type === 'image/png' ? 'PNG' : 'JPEG', name: file.name });
      setPptNotice(null);
    };
    reader.readAsDataURL(file);
  }

  async function createPpt() {
    if (existingPpt && (!existingPpt.name.toLowerCase().endsWith('.pptx') || existingPpt.size > 20_000_000)) {
      setPptNotice({ text: '20MB 이하의 PPTX 파일을 선택해 주세요.', kind: 'error' });
      return;
    }
    if (!validStyle) {
      setPptNotice({ text: '글꼴 이름, 글자 크기(16~100), 한 장의 줄 수(1~6)를 확인해 주세요.', kind: 'error' });
      return;
    }
    if (existingPpt && !existingPptData) {
      setPptNotice({ text: existingPptError || '기존 PPTX 파일을 읽는 중입니다.', kind: 'error' });
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
        setFontListOpen(false);
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
        addSelectionShortcut.current(activeSong);
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
  }, [activeSong, page, prepared]);

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
          <div className="nav__actions"><span className={`app-online ${libraryError ? 'is-error' : ''}`}><i aria-hidden="true" />{loadingSongs ? '연결 확인 중' : libraryError ? '연결을 확인해 주세요' : '데이터베이스 연결됨'}</span><a className="btn btn--primary" href="#create">PPT 제작</a></div>
          <button className="nav__toggle" type="button" aria-label={navOpen ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={navOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        </div>
      </header>}

      {page === 'create' ? (
        <main className={`editor-page${inspectorDock === 'left' ? ' is-inspector-left' : ''}${inspectorCollapsed ? ' is-inspector-collapsed' : ''}`} id="create" style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties} onPointerDownCapture={(event) => { const target = event.target; if (target instanceof Element && target.closest('.editor-slide-text, .text-box-handle, .inspector-resize-handle')) return; setSelectedTextSlide(null); }}>
          <aside className="editor-sidebar" aria-label="찬양 곡 선택">
            <a className="editor-brand" href="#create" aria-label="Yebit 찬양 PPT 제작">
              <img src="/assets/figma/editor-logo.png" width="42" height="42" alt="" />
              <span><strong>Yebit</strong><small>찬양 라이브러리</small></span>
            </a>
            <div ref={searchWidgetRef} className="editor-search-shell" onPointerMove={trackSearchGlassReflection} onPointerLeave={resetSearchGlassReflection}>
              {!searchOpen ? <button className="editor-search-widget" type="button" aria-label="곡 제목 또는 찬송가 번호 검색" onClick={() => setSearchOpen(true)}>
                <span className="editor-search-off"><img src="/assets/figma/search.svg" alt="" /><span>곡 제목 또는 찬송가 번호</span></span>
              </button> : <div className={`editor-search-widget is-active${query.trim() ? ' has-query' : ''}`}>
                <form className="editor-search" onSubmit={searchSongs}>
                  <label className="visually-hidden" htmlFor="worship-song-search">곡 제목 또는 찬송가 번호</label>
                  <span className="editor-search-input"><img src="/assets/figma/search.svg" alt="" /><input id="worship-song-search" ref={searchInputRef} autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value); setSearchNotice(null); setResults([]); setExternalResults([]); setProviderInfo([]); }} placeholder="곡 제목 또는 찬송가 번호" /></span>
                  <button className="visually-hidden" type="submit" disabled={searching || !query.trim()}>검색</button>
                </form>
                {query.trim() && <div className="editor-search-results" aria-live="polite">
                  {additionalLiveSongMatches.length > 0 && <div className="search-result-group"><span>내 곡 목록</span>{additionalLiveSongMatches.map((song) => <div className="editor-favorite-row" key={song.id}><button className="search-result-row" type="button" onClick={() => selectSong(song)}><strong>{song.title}</strong><small>{displayKnown(song.artist)}</small></button><button className={`favorite-toggle${favoriteIds.includes(song.id) ? ' is-favorite' : ''}`} type="button" onClick={() => toggleFavorite(song)} aria-label={favoriteIds.includes(song.id) ? `${song.title} 즐겨찾기 해제` : `${song.title} 즐겨찾기 추가`}>{favoriteIds.includes(song.id) ? '★' : '☆'}</button></div>)}</div>}
                  {searching && <p className="search-result-hint">곡을 찾고 있습니다…</p>}
                  {!searching && !searchNotice && <p className="search-result-hint">Enter를 누르면 전체 검색을 시작합니다.</p>}
                  {searchNotice && <p className={`search-result-hint ${searchNotice.kind ?? ''}`}>{searchNotice.text}</p>}
                  {providerInfo.length > 0 && <div className="search-result-group"><span>YouTube에서 찾은 가사 · {providerInfo.length}곡</span>{providerInfo.map((song, index) => <button className="search-result-row" key={`${song.videoId || song.source}-${index}`} type="button" onClick={() => selectSong({ id: -(100000000 + index), title: song.title, artist: song.artist || null, author: null, composer: null, category: null, hymnNumber: null, status: 'USER_SUPPLIED', source: song.url, lyrics: song.lyrics })}><strong>{song.title}</strong><small>{song.artist} · 가사 미리보기</small></button>)}</div>}
                  {externalResults.length > 0 && <div className="search-result-group"><span>LRCLIB 검색 결과 · {externalResults.length}</span>{externalResults.map((song) => <button className="search-result-row" key={song.id} type="button" onClick={() => selectSong(song)}><strong>{song.title}</strong><small>{displayPerson(song.artist)} · {displayPerson(song.album)}</small></button>)}</div>}
                  {results.length > 0 && <div className="search-result-group"><span>내 곡 목록 · {results.length}</span>{results.map((song) => <div className="editor-favorite-row" key={song.id}><button className="search-result-row" type="button" onClick={() => selectSong(song)}><strong>{song.title}</strong><small>작사 {displayPerson(song.author)}</small></button><button className={`favorite-toggle${favoriteIds.includes(song.id) ? ' is-favorite' : ''}`} type="button" onClick={() => toggleFavorite(song)} aria-label={favoriteIds.includes(song.id) ? `${song.title} 즐겨찾기 해제` : `${song.title} 즐겨찾기 추가`}>{favoriteIds.includes(song.id) ? '★' : '☆'}</button></div>)}</div>}
                </div>}
              </div>}
            </div>
            <div className="editor-tabs" role="group" aria-label="곡 라이브러리">
              <button type="button" aria-pressed={editorTab === 'songs'} onClick={() => changeEditorTab('songs')}>최근</button>
              <button type="button" aria-pressed={editorTab === 'favorites'} onClick={() => changeEditorTab('favorites')}>즐겨찾기</button>
              <button type="button" aria-pressed={editorTab === 'trending'} onClick={() => changeEditorTab('trending')}>트렌드</button>
              {showLyricsTab && <button className={`editor-tab--lyrics${activeSong ? '' : ' is-leaving'}`} type="button" aria-pressed={editorTab === 'lyrics'} onClick={() => changeEditorTab('lyrics')}>가사</button>}
            </div>
            <div className="editor-controls">
              {editorTab === 'songs' || editorTab === 'lyrics' ? <div className="editor-control-group">
                {editorTab === 'songs' && recentSongs.length > 0 && <section className="recent-song-section" aria-label="최근 곡">
                  <div className="recent-song-list">{recentSongs.slice(0, 5).map((recent) => { const videoId = recent.youtubeVideoId || youtubeVideos.find((video) => video.songId === recent.id)?.videoId; const imageUrl = youtubeThumbnailUrl(videoId); return <div className="recent-song-card-shell" key={`${recent.id}:${recent.title}`}><div className="recent-song-card">{imageUrl && <img className="recent-song-card__image" src={imageUrl} alt="" />}<span className="recent-song-card__glass"><button className="recent-song-card__title" type="button" onClick={() => void openRecentSong(recent)}><strong>{recent.title}</strong></button><span className="recent-song-card__meta"><small>최근 선택 · {new Date(recent.selectedAt).toLocaleDateString('ko-KR')}</small></span></span></div><button className="recent-song-delete" type="button" onClick={() => setRecentSongs((songs) => songs.filter((song) => recentTitleKey(song.title) !== recentTitleKey(recent.title)))} aria-label={`${recent.title} 최근 목록에서 삭제`}>×</button></div>; })}</div>
                </section>}
                {editorTab === 'lyrics' && activeSong && <article className="song-detail" aria-live="polite"><div className="detail-title"><div><p className="eyebrow">선택한 찬양</p><h3>{activeSong.title}</h3></div><div className="detail-actions">{activeSong.id > 0 && <button className={`favorite-toggle${favoriteIds.includes(activeSong.id) ? ' is-favorite' : ''}`} type="button" onClick={() => toggleFavorite(activeSong)} aria-label={favoriteIds.includes(activeSong.id) ? '즐겨찾기 해제' : '즐겨찾기 추가'}>{favoriteIds.includes(activeSong.id) ? '★' : '☆'}</button>}<button className="icon-button" onClick={() => { setActiveSong(null); setEditorTab('songs'); }} aria-label="선택한 곡 닫기">×</button></div></div><dl className="song-meta"><div><dt>공연팀</dt><dd>{displayPerson(activeSong.artist)}</dd></div></dl><div className="lyrics-preview"><span>가사 미리보기</span><p>{activeSong.lyrics?.trim() ? <>{activeSong.id < 0 ? activeSong.lyrics.trim() : activeSong.lyrics.trim().slice(0, 520)}{activeSong.id > 0 && activeSong.lyrics.length > 520 ? '…' : ''}</> : lyricsLoadingSongId === activeSong.id ? '가사를 불러오는 중입니다.' : lyricsLoadError?.songId === activeSong.id ? lyricsLoadError.message : '이 곡은 아직 가사가 등록되어 있지 않습니다.'}</p></div>{activeSong.id < 0 && <p className="editor-hint">{activeSong.source?.includes('youtube.com') ? 'YouTube 영상 설명란에서 찾은 가사 후보입니다. 곡과 가사를 확인한 뒤 사용해 주세요. DB에는 저장되지 않습니다.' : 'LRCLIB 제공 가사입니다. 곡과 가사를 확인하고 이용 권한이 있는 경우에 사용해 주세요. DB에는 저장되지 않습니다.'}</p>}<button className="btn btn--secondary add-button" onClick={() => addSelection(activeSong)}>제작 목록에 추가</button></article>}
                {editorTab === 'songs' && selected.length > 0 && <section ref={selectedQueueRef} className="editor-selected-queue" aria-labelledby="editor-selected-title"><div className="editor-heading"><h2 id="editor-selected-title">제작 목록</h2><span>{selected.length}곡</span></div><ol className="selected-list">{selected.map((song, index) => <li key={song.id} data-song-id={song.id} draggable onDragStart={(event) => { draggedSongIdRef.current = song.id; originalSongOrderRef.current = selected.map((item) => item.id); setDraggedSongId(song.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(song.id)); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; reorderDraggedSong(song.id, event.clientY, event.currentTarget); }} onDrop={(event) => event.preventDefault()} onDragEnd={() => { if (originalSongOrderRef.current?.some((id, orderIndex) => selected[orderIndex]?.id !== id)) { setRemovedSlideIndexes([]); setSlidePositions({}); setSlideTextOverrides({}); setSlideTextColors({}); setEditingSlide(null); } draggedSongIdRef.current = null; originalSongOrderRef.current = null; setDraggedSongId(null); }} className={draggedSongId === song.id ? 'is-dragging' : ''} aria-roledescription="끌어서 순서 변경"><span className="selected-drag-handle" aria-hidden="true">⠿</span><span className="selected-index">{String(index + 1).padStart(2, '0')}</span><span className="selected-song"><strong>{song.title}</strong></span><div className="selected-actions"><button type="button" onClick={() => moveSong(index, -1)} disabled={index === 0} aria-label={`${song.title} 위로`}>↑</button><button type="button" onClick={() => moveSong(index, 1)} disabled={index === selected.length - 1} aria-label={`${song.title} 아래로`}>↓</button><button type="button" onClick={() => { setRemovedSlideIndexes([]); setSelected((items) => items.filter((item) => item.id !== song.id)); }} aria-label={`${song.title} 제거`}>×</button></div></li>)}</ol></section>}
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
            <div className="editor-toolbar"><div className="editor-toolbar__left"><div className="editor-title-control" ref={titleControlRef}><svg className="editor-title-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M13 14h5m-2-2 2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>{titleEditOpen ? <input className="editor-document-title-input" aria-label="프레젠테이션 제목 편집" style={{width:`${Math.max(1, presentationTitle.length)}em`}} autoFocus value={presentationTitle} onChange={(event) => setPresentationTitle(event.target.value)} maxLength={80} onBlur={() => setTitleEditOpen(false)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); setTitleEditOpen(false); } }} /> : <button className="editor-document-title" type="button" aria-label="프레젠테이션 제목 수정" aria-expanded={titleEditOpen} onClick={() => setTitleEditOpen(true)}><span>{presentationTitle.trim() || '제목 없는 디자인'}</span></button>}</div><div className="editor-size-control" ref={sizeControlRef}><button className="editor-page-count" type="button" aria-label={`슬라이드 크기 ${slideSize.width} 곱하기 ${slideSize.height} 픽셀`} aria-expanded={sizeOpen} onClick={() => setSizeOpen((open) => !open)}><span>{slideSize.width}×{slideSize.height} px</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 7.5 5.5 5 5.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>{sizeOpen && <div className="editor-size-menu"><div className="editor-size-presets">{[{label:'16:9',width:1280,height:720},{label:'16:10',width:1280,height:800},{label:'4:3',width:1280,height:960},{label:'1:1',width:960,height:960}].map((preset) => <button type="button" key={preset.label} aria-pressed={slideSize.width===preset.width&&slideSize.height===preset.height} onClick={() => setSlideSize({width:preset.width,height:preset.height})}>{preset.label}</button>)}</div><div className="editor-size-custom"><label>가로<input type="number" min="320" max="3840" value={slideSize.width} onChange={(event) => setSlideSize((size) => ({...size,width:Math.max(320,Math.min(3840,Number(event.target.value)||320))}))}/></label><span>×</span><label>세로<input type="number" min="320" max="3840" value={slideSize.height} onChange={(event) => setSlideSize((size) => ({...size,height:Math.max(320,Math.min(3840,Number(event.target.value)||320))}))}/></label></div></div>}</div></div></div>
            <div className="editor-stage">
              {previewError ? <div className="editor-canvas-message"><strong>미리보기를 열 수 없습니다</strong><span>{previewError}</span><button type="button" className="preview-retry" onClick={() => setPreviewRetry((value) => value + 1)}>다시 시도</button></div> : previewLoading && !prepared ? <div className="editor-canvas-message"><span className="preview-spinner" aria-hidden="true"/><strong>슬라이드를 불러오는 중</strong></div> : <div className="editor-page-stack" onScroll={(event) => { const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-slide-index]')); const middle = event.currentTarget.getBoundingClientRect().top + event.currentTarget.clientHeight / 2; const nearest = cards.reduce((best, card) => Math.abs(card.getBoundingClientRect().top + card.offsetHeight / 2 - middle) < Math.abs(best.getBoundingClientRect().top + best.offsetHeight / 2 - middle) ? card : best, cards[0]); if (nearest) { setPreviewIndex(Number(nearest.dataset.slideIndex)); setSelectedTextSlide(null); } }}>
                {(prepared?.thumbnails ?? []).map((thumbnail, slide) => { const position = slidePositions[slide] ?? prepared?.slides[slide]?.textPosition ?? { x: pptStyle.textX, y: pptStyle.textY, width: pptStyle.textWidth, height: pptStyle.textHeight }; const selectedText = selectedTextSlide === slide; return <div className={`editor-page-sheet ${previewIndex === slide ? 'is-current' : ''}`} data-slide-index={slide} key={slide} style={{aspectRatio:`${slideSize.width} / ${slideSize.height}`}}><img src={`data:image/png;base64,${thumbnail}`} alt="슬라이드 배경"/><div className="editor-slide-text" style={{left:`${position.x-position.width/2}%`,top:`${position.y-position.height/2}%`,width:`${position.width}%`,height:`${position.height}%`,fontFamily:pptStyle.fontFamily,fontSize:`${pptStyle.fontSize/960*100}cqw`,fontWeight:pptStyle.bold?700:400,color:slideTextColors[slide]??pptStyle.textColor,justifyContent:pptStyle.alignment==='LEFT'?'flex-start':pptStyle.alignment==='RIGHT'?'flex-end':'center',lineHeight:1.2}} onClick={() => { if (editingSlide !== slide) { setPreviewIndex(slide); setSelectedTextSlide(slide); } }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setPreviewIndex(slide); setSelectedTextSlide(slide); setEditingSlide(slide); }} onPointerDown={(event) => { if (selectedText && editingSlide !== slide && !(event.target instanceof HTMLTextAreaElement)) startTextBoxInteraction(event, slide, position); }} onPointerMove={moveTextBoxInteraction} onPointerUp={endTextBoxInteraction} onPointerCancel={endTextBoxInteraction} role="button" tabIndex={0} aria-label={`${slide+1}페이지 가사 텍스트 선택`} title="두 번 클릭하여 가사 수정">{editingSlide === slide ? <textarea className="editor-slide-textarea" autoFocus value={slideTextOverrides[slide] ?? prepared?.slides[slide]?.lines.join('\n') ?? ''} onChange={(event) => setSlideTextOverrides((items) => ({ ...items, [slide]: event.target.value }))} onPointerDown={(event) => event.stopPropagation()} onBlur={() => setEditingSlide(null)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setEditingSlide(null); } }} aria-label={`${slide+1}페이지 가사 편집`} /> : <span style={{display:'block',width:'100%',textAlign:pptStyle.alignment.toLowerCase() as CanvasTextAlign}}>{slideTextOverrides[slide] ?? prepared?.slides[slide]?.lines.join('\n')}</span>}</div>{selectedText && <div className="text-box-selection" style={{left:`${position.x-position.width/2}%`,top:`${position.y-position.height/2}%`,width:`${position.width}%`,height:`${position.height}%`}} onPointerMove={moveTextBoxInteraction} onPointerUp={endTextBoxInteraction} onPointerCancel={endTextBoxInteraction} role="group" aria-label="가사 상자 위치와 크기 조절"><i className="text-box-handle text-box-handle--tl"/><i className="text-box-handle text-box-handle--tr"/><i className="text-box-handle text-box-handle--bl"/><button className="text-box-handle text-box-handle--br" type="button" aria-label="가사 상자 크기 조절" onPointerDown={(event) => startTextBoxInteraction(event, slide, position, 'resize')} onPointerMove={moveTextBoxInteraction} onPointerUp={endTextBoxInteraction} onPointerCancel={endTextBoxInteraction}/></div>}<span className="editor-page-label">{slide + 1} 페이지</span><button className="editor-page-delete" type="button" aria-label={`${slide + 1}페이지 삭제`} onClick={() => { let original = 0; let visible = 0; while (visible < slide) { if (!removedSlideIndexes.includes(original)) visible += 1; original += 1; } while (removedSlideIndexes.includes(original)) original += 1; setRemovedSlideIndexes((indexes) => [...indexes, original]); setSlideTextOverrides({}); setSlidePositions({}); setSlideTextColors({}); setPreviewIndex(Math.max(0, slide - 1)); setSelectedTextSlide(null); setEditingSlide(null); }}>×</button></div>; })}
              </div>}
            </div>
            <div className="editor-filmstrip" aria-label="슬라이드 페이지">
              {Array.from({ length: preview?.slideCount ?? 0 }, (_, slide) => {
                const position = slidePositions[slide] ?? prepared?.slides[slide]?.textPosition ?? { x: 50, y: 50, width: 60, height: 25 };
                return <div className={`filmstrip-page-shell ${preview?.slideIndex === slide ? 'is-active' : ''}`} key={slide}>
                  <button className="filmstrip-page" type="button" onClick={() => { setPreviewIndex(slide); document.querySelector<HTMLElement>(`[data-slide-index="${slide}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} disabled={!preview} aria-label={`${slide + 1}번 슬라이드 미리보기`} aria-current={preview?.slideIndex === slide ? 'page' : undefined}>
                    <span className="filmstrip-canvas">{prepared?.thumbnails[slide] && <img src={`data:image/png;base64,${prepared.thumbnails[slide]}`} alt="" />}<span className="filmstrip-lyrics" style={{left:`${position.x-position.width/2}%`,top:`${position.y-position.height/2}%`,width:`${position.width}%`,height:`${position.height}%`,fontFamily:pptStyle.fontFamily,fontSize:`${pptStyle.fontSize/960*100}cqw`,fontWeight:pptStyle.bold?700:400,color:slideTextColors[slide]??pptStyle.textColor,textAlign:pptStyle.alignment.toLowerCase() as CanvasTextAlign}}>{slideTextOverrides[slide] ?? prepared?.slides[slide]?.lines.join('\n')}</span></span><span className="filmstrip-number">{slide + 1}</span>
                  </button>
                  <button className="filmstrip-page-delete" type="button" onClick={() => removeSlide(slide)} aria-label={`${slide + 1}번 슬라이드 삭제`}>×</button>
                </div>;
              })}
              <button className="filmstrip-add" type="button" onClick={() => { const nextIndex = preview?.slideCount ?? 1; setExtraSlideCount((count) => count + 1); setPreviewIndex(nextIndex); }} aria-label="페이지 추가"><span aria-hidden="true">＋</span><small>페이지 추가</small></button>
            </div>
          </section>
          {!inspectorCollapsed && <aside className="editor-inspector" aria-label="슬라이드 편집">
            <div className={`inspector-resize-handle is-${inspectorDock}`} role="separator" aria-orientation="vertical" aria-label="편집 도구 너비 조절" aria-valuemin={240} aria-valuemax={520} aria-valuenow={Math.round(inspectorWidth)} tabIndex={0} onPointerDown={startInspectorResize} onPointerMove={resizeInspector} onPointerUp={stopInspectorResize} onPointerCancel={stopInspectorResize} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const direction = event.key === 'ArrowRight' ? 1 : -1; setInspectorWidth((width) => Math.max(240, Math.min(520, width + direction * (event.shiftKey ? 32 : 12)))); } }} />
            <div className="inspector-heading"><div><p className="editor-kicker">편집 도구</p><h2>슬라이드 디자인</h2></div><span className="editor-count">{preview ? `${preview.slideIndex + 1} / ${preview.slideCount}` : '—'}</span><button className="inspector-dock-toggle" type="button" onClick={() => setInspectorDock((dock) => dock === 'right' ? 'left' : 'right')} aria-label={inspectorDock === 'right' ? '편집 도구를 왼쪽에 배치' : '편집 도구를 오른쪽에 배치'} title={inspectorDock === 'right' ? '왼쪽 벽에 배치' : '오른쪽 벽에 배치'}>{inspectorDock === 'right' ? '⇤' : '⇥'}</button><button className="inspector-hide-toggle" type="button" onClick={() => setInspectorCollapsed(true)} aria-label="편집 도구 숨기기" title="편집 도구 숨기기">×</button></div>
            <div className="inspector-controls">
              <label className="style-field"><span>템플릿</span><select value={template} onChange={(event) => { const value = event.target.value; setTemplate(value); if (templateStyles[value]) setPptStyle({ ...templateStyles[value] }); }}><option value="original">기본 남색</option><option value="sky">맑은 하늘</option><option value="white">깔끔한 흰색</option><option value="black">선명한 검정</option><option value="custom">직접 설정</option></select></label>
              <div className="inspector-group"><h3>색상</h3><div className="style-grid"><label className="style-field"><span>배경</span><input type="color" value={pptStyle.backgroundColor} onChange={(event) => updateStyle({ backgroundColor: event.target.value })} /></label><label className="style-field"><span>글자</span><input type="color" value={slideTextColors[previewIndex] ?? pptStyle.textColor} onChange={(event) => setSlideTextColors((colors) => ({ ...colors, [previewIndex]: event.target.value }))} /></label></div></div>
              <div className="inspector-group"><h3>글자</h3><div className="style-grid"><div className="style-field style-field--wide font-picker"><span>글꼴</span><div className="font-search-glass"><input type="search" value={fontQuery} onFocus={() => setFontListOpen(true)} onChange={(event) => { setFontQuery(event.target.value); setFontListOpen(true); }} placeholder={pptStyle.fontFamily || '글꼴 검색'} aria-label="글꼴 검색" aria-expanded={fontListOpen}/><button type="button" aria-label="글꼴 목록 열기" onClick={() => setFontListOpen((open) => !open)}>⌄</button></div>{fontListOpen && <div className="font-options" role="listbox">{fontOptions.filter((font) => font.toLocaleLowerCase().includes(fontQuery.trim().toLocaleLowerCase())).map((font) => <button type="button" role="option" aria-selected={pptStyle.fontFamily === font} key={font} style={{fontFamily:font}} onClick={() => { updateStyle({fontFamily:font.includes('Malgun Gothic') ? 'Malgun Gothic' : font.includes('NanumGothic') ? 'NanumGothic' : font}); setFontQuery(''); setFontListOpen(false); }}>{font}</button>)}{fontQuery.trim() && !fontOptions.some((font) => font.toLocaleLowerCase() === fontQuery.trim().toLocaleLowerCase()) && <button type="button" role="option" onClick={() => { updateStyle({fontFamily:fontQuery.trim()}); setFontListOpen(false); }}>{fontQuery.trim()} 사용</button>}</div>}</div><label className="style-field"><span>크기</span><input type="number" min="16" max="100" value={pptStyle.fontSize || ''} onChange={(event) => updateStyle({ fontSize: Number(event.target.value) })} /></label><label className="style-field"><span>한 장의 줄 수</span><input type="number" min="1" max="6" value={pptStyle.linesPerSlide || ''} onChange={(event) => updateStyle({ linesPerSlide: Number(event.target.value) })} /></label><label className="style-field style-field--wide"><span>정렬</span><select value={pptStyle.alignment} onChange={(event) => updateStyle({ alignment: event.target.value as PptStyle['alignment'] })}><option value="LEFT">왼쪽</option><option value="CENTER">가운데</option><option value="RIGHT">오른쪽</option></select></label><div className="text-align-actions style-field--wide"><button type="button" onClick={() => { const fallback = prepared?.slides[previewIndex]?.textPosition ?? { x: 50, y: 50, width: pptStyle.textWidth, height: pptStyle.textHeight }; setSlidePositions((items) => ({ ...items, [previewIndex]: { ...(items[previewIndex] ?? fallback), x: 50, y: 50 } })); setPptStyle((style) => ({ ...style, alignment: 'CENTER' })); }}>가운데 정렬</button></div><label className="style-check"><input type="checkbox" checked={pptStyle.bold} onChange={(event) => updateStyle({ bold: event.target.checked })} /> 굵게</label></div></div>
              {pptStyle.fontSize * pptStyle.linesPerSlide * 1.2 > 300 && <p className="style-hint">글자 크기와 줄 수가 크면 가사가 잘릴 수 있습니다.</p>}
              <div className="inspector-group"><h3>배경 이미지</h3><label className="file-field"><span className="file-picker-button">이미지 선택</span><input key={imageInputKey} type="file" accept="image/png,image/jpeg" onChange={chooseBackground} /><small>{backgroundImage ? backgroundImage.name : 'PNG 또는 JPEG · 최대 5MB'}</small></label>{backgroundImage && <button type="button" className="clear-image" onClick={() => { setBackgroundImage(null); setImageInputKey((key) => key + 1); }}>배경 이미지 제거</button>}</div>
              <div className="inspector-group"><h3>기존 PPT</h3><label className="file-field"><span className="file-picker-button">PPTX 선택</span><input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(event) => setExistingPpt(event.target.files?.[0] ?? null)} /><small>{existingPpt ? `${existingPpt.name} · 기존 슬라이드 뒤에 추가` : '최대 20MB · 새 슬라이드에 디자인 적용'}</small></label></div>
              {pptNotice && <p className={`notice ${pptNotice.kind ?? ''}`} role="status" aria-live="polite">{pptNotice.text}</p>}
            </div>
            <div className="inspector-footer"><button className="editor-queue-link" type="button" onClick={() => { setEditorTab('songs'); window.requestAnimationFrame(() => selectedQueueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); }} aria-label={`제작 목록, ${selected.length}곡 · ${preview?.slideCount ?? 1}장`}>{selected.length}곡 · {preview?.slideCount ?? 1}장 <span>제작 목록</span></button><button className="btn btn--primary" type="button" onClick={createPpt} disabled={creating}>{creating ? '만드는 중…' : 'PPTX 다운로드'}</button></div>
          </aside>}
          {inspectorCollapsed && <button className={`inspector-reopen-tab is-${inspectorDock}`} type="button" onClick={() => setInspectorCollapsed(false)} aria-label="편집 도구 다시 열기" title="편집 도구 다시 열기">{inspectorDock === 'right' ? '‹' : '›'}<span>편집 도구</span></button>}
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
      {page === 'manage' && <footer className="app-footer closing"><span>찬양 PPT</span><span>예배 자료 제작 도구</span><a className="link" href="#create">PPT 제작</a></footer>}
    </>
  );
}
