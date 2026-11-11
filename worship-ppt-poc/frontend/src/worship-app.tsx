import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { Song, SongRequest } from './types';

type Notice = { text: string; kind?: 'error' | 'success' } | null;
type PptStyle = {
  backgroundColor: string; textColor: string; fontFamily: string; fontSize: number;
  alignment: 'LEFT' | 'CENTER' | 'RIGHT'; linesPerSlide: number; bold: boolean;
};
type Preview = { imageBase64: string; slideIndex: number; slideCount: number };
type PptPayload = { songIds: number[]; externalSongs?: { id: number; title: string; artist: string | null; lyrics: string }[]; pptxBase64?: string; style: PptStyle & { backgroundImageBase64?: string; backgroundImageType?: string } };

const templateStyles: Record<string, PptStyle> = {
  original: { backgroundColor: '#16233a', textColor: '#ffffff', fontFamily: 'Apple SD Gothic Neo', fontSize: 40, alignment: 'CENTER', linesPerSlide: 2, bold: false },
  sky: { backgroundColor: '#dff1ff', textColor: '#173149', fontFamily: 'Apple SD Gothic Neo', fontSize: 40, alignment: 'CENTER', linesPerSlide: 2, bold: false },
  white: { backgroundColor: '#ffffff', textColor: '#171717', fontFamily: 'Apple SD Gothic Neo', fontSize: 40, alignment: 'CENTER', linesPerSlide: 2, bold: false },
  black: { backgroundColor: '#000000', textColor: '#ffffff', fontFamily: 'Apple SD Gothic Neo', fontSize: 40, alignment: 'CENTER', linesPerSlide: 2, bold: false },
};

function displayPerson(value?: string | null) {
  return value?.trim() || '정보 없음';
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
  const [readySongs, setReadySongs] = useState<Song[]>([]);
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [query, setQuery] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [selected, setSelected] = useState<Song[]>([]);
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [searchNotice, setSearchNotice] = useState<Notice>(null);
  const [pptNotice, setPptNotice] = useState<Notice>(null);
  const [searching, setSearching] = useState(false);
  const [providerInfo, setProviderInfo] = useState<{ title: string; artist: string; source: string }[]>([]);
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
  const [editorTab, setEditorTab] = useState<'songs' | 'design'>('songs');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewRetry, setPreviewRetry] = useState(0);

  const validStyle = Boolean(pptStyle.fontFamily.trim()) && pptStyle.fontFamily.length <= 80 && Number.isInteger(pptStyle.fontSize) && pptStyle.fontSize >= 16 && pptStyle.fontSize <= 100 && Number.isInteger(pptStyle.linesPerSlide) && pptStyle.linesPerSlide >= 1 && pptStyle.linesPerSlide <= 6;

  function presentationPayload(): PptPayload {
    return {
      songIds: selected.map((song) => song.id),
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
    if (!selected.length) {
      setPreview(null); setPreviewLoading(false); setPreviewError('');
      return;
    }
    if (!validStyle) {
      setPreview(null); setPreviewLoading(false); setPreviewError('글꼴과 글자 크기, 줄 수를 확인해 주세요.');
      return;
    }
    if (existingPpt && (!existingPpt.name.toLowerCase().endsWith('.pptx') || existingPpt.size > 20_000_000)) {
      setPreview(null); setPreviewLoading(false); setPreviewError('20MB 이하의 PPTX 파일을 선택해 주세요.');
      return;
    }
    if (existingPptError) { setPreview(null); setPreviewLoading(false); setPreviewError(existingPptError); return; }
    if (existingPpt && !existingPptData) { setPreview(null); setPreviewLoading(true); return; }
    const controller = new AbortController();
    setPreviewLoading(true); setPreviewError('');
    const timer = window.setTimeout(async () => {
      try {
        const result = await api<Preview>('/ppt/preview', { presentation: presentationPayload(), slideIndex: previewIndex }, controller.signal);
        if (controller.signal.aborted) return;
        setPreview(result.data);
        if (result.data.slideIndex !== previewIndex) setPreviewIndex(result.data.slideIndex);
      } catch (error) {
        if (!controller.signal.aborted) { setPreview(null); setPreviewError(error instanceof Error ? error.message : '미리보기를 불러오지 못했습니다.'); }
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [selected, pptStyle, backgroundImage, existingPpt, existingPptData, existingPptError, previewIndex, validStyle, previewRetry]);

  useEffect(() => {
    function syncPage() {
      setPage(window.location.hash === '#manage' ? 'manage' : 'create');
    }
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavOpen(false);
    }
    document.body.classList.toggle('nav-locked', navOpen);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.classList.remove('nav-locked');
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [navOpen]);

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

  async function searchSongs(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setResults([]); setExternalResults([]); setProviderInfo([]); setActiveSong(null); setSearchNotice(null);
    const messages: string[] = [];
    try {
      let found: Song[] = [];
      try {
        const url = new URL('https://lrclib.net/api/search');
        url.searchParams.set('track_name', query.trim());
        const response = await fetch(url, { headers: { 'X-User-Agent': 'WorshipPPT/1.0 (https://github.com/ryuyejun/worship-ppt-poc)' }, signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('요청 실패');
        const records = await response.json() as { id: number; trackName: string; artistName: string; albumName: string; plainLyrics: string | null; syncedLyrics: string | null }[];
        const unique = new Set<string>();
        found = records.filter((record) => {
          if (!record.plainLyrics?.trim() && !record.syncedLyrics?.trim()) return false;
          const key = [record.trackName, record.artistName, record.albumName, record.plainLyrics || record.syncedLyrics || ''].map((value) => (value || '').normalize('NFC').toLowerCase().replace(/\s+/g, '')).join('|');
          if (unique.has(key)) return false;
          unique.add(key); return true;
        }).map((record) => ({
          id: -record.id, title: record.trackName, author: null, composer: null, artist: record.artistName,
          status: 'USER_SUPPLIED', category: null, hymnNumber: null, source: 'https://lrclib.net', album: record.albumName,
          lyrics: (record.plainLyrics || record.syncedLyrics?.replace(/^\[\d{2}:\d{2}(?:\.\d+)?\]\s*/gm, '') || '').trim(),
        }));
        messages.push(`LRCLIB: 가사 ${found.length}곡`);
      } catch { messages.push('LRCLIB: 연결 실패'); }
      if (found.length) {
        setExternalResults(found);
        setSearchNotice({ text: messages.join(' · ') + ' · 작사자는 확인할 수 없으므로 가수와 가사를 확인해 주세요.' });
        return;
      }
      try {
        const providers = await api<{ candidates: { title: string; artist: string; source: string }[]; status: string[] }>('/providers/search', { title: query.trim() });
        const unique = new Set<string>();
        setProviderInfo(providers.data.candidates.filter((candidate) => {
          const key = [candidate.title, candidate.artist, candidate.source].map((value) => value.normalize('NFC').toLowerCase().replace(/\s+/g, '')).join('|');
          if (unique.has(key)) return false; unique.add(key); return true;
        }));
        messages.push(...providers.data.status);
      } catch { messages.push('추가 제공처: 조회 실패'); }
      try {
        const local = await api<Song[]>('/search', { title: query.trim() });
        setResults(local.data);
        messages.push(`내 DB: 가사 ${local.data.length}곡`);
        if (local.data.length === 1) setActiveSong(local.data[0]);
        if (!local.data.length) { messages.push('곡 추가 대기열에 기록했습니다'); await loadRequests(); }
      } catch { messages.push('내 DB: 조회 실패'); }
      setSearchNotice({ text: messages.join(' · ') });
    } finally { setSearching(false); }
  }

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
    setSelected((items) => [...items, song]);
    setPptNotice({ text: 'PPT 제작 목록에 추가했습니다.', kind: 'success' });
  }

  function moveSong(index: number, delta: number) {
    setSelected((items) => {
      const next = [...items];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }

  function updateStyle(change: Partial<PptStyle>) {
    setPptStyle((current) => ({ ...current, ...change }));
    setTemplate('custom');
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
    if (!selected.length) {
      setPptNotice({ text: '가사가 저장된 곡을 먼저 추가해 주세요.', kind: 'error' });
      return;
    }
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
      downloadPpt(response.data, '찬양 PPT.pptx');
      setPptNotice({ text: 'PPTX를 다운로드했습니다.', kind: 'success' });
    } catch (error) {
      setPptNotice({ text: error instanceof Error ? error.message : 'PPTX 생성에 실패했습니다.', kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

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

  const filteredReady = useMemo(() => {
    const normalized = libraryQuery.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, '');
    if (!normalized) return readySongs;
    return readySongs.filter((song) => `${song.title}${song.author ?? ''}`.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, '').includes(normalized));
  }, [libraryQuery, readySongs]);

  const categories = useMemo(() => ({ hymns: readySongs.filter((song) => song.category?.toUpperCase() === 'HYMN').length, songs: readySongs.length }), [readySongs]);

  return (
    <>
      <header className={`nav app-nav${navOpen ? ' is-open' : ''}`}>
        <div className="wrap nav__bar">
          <a className="skip-link" href={page === 'create' ? '#create' : '#manage'}>본문 바로가기</a>
          <a className="nav__logo app-brand" href="#create" onClick={() => { setPage('create'); setNavOpen(false); }} aria-label="찬양 PPT 제작 화면">
            <img src="/logo.png" width="34" height="34" alt="" />
            <span>찬양 PPT</span>
          </a>
          <nav className="nav__links app-links" aria-label="주요 메뉴">
            <a className="nav__link" href="#create" aria-current={page === 'create' ? 'page' : undefined} onClick={() => { setPage('create'); setNavOpen(false); }}>PPT 제작</a>
            <a className="nav__link" href="#manage" aria-current={page === 'manage' ? 'page' : undefined} onClick={() => { setPage('manage'); setNavOpen(false); }}>곡 관리</a>
          </nav>
          <div className="nav__actions"><span className={`app-online ${libraryError ? 'is-error' : ''}`}><i aria-hidden="true" />{loadingSongs ? '연결 확인 중' : libraryError ? '연결을 확인해 주세요' : '데이터베이스 연결됨'}</span>{page === 'create' ? <button className="btn btn--primary" type="button" onClick={createPpt} disabled={creating || !selected.length}>{creating ? '만드는 중…' : 'PPTX 다운로드'}</button> : <a className="btn btn--primary" href="#create">PPT 제작</a>}</div>
          <button className="nav__toggle" type="button" aria-label={navOpen ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={navOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        </div>
      </header>

      {page === 'create' ? (
        <main className="editor-page" id="create">
          <aside className="editor-sidebar" aria-label="PPT 제작 설정">
            <div className="editor-sidebar-head">
              <div><p className="editor-kicker">예배 자료 제작</p><h1>PPT 만들기</h1></div>
              <span className="editor-count">{selected.length}곡 선택</span>
            </div>
            <div className="editor-tabs" role="group" aria-label="제작 설정">
              <button type="button" aria-pressed={editorTab === 'songs'} onClick={() => setEditorTab('songs')}>곡 선택</button>
              <button type="button" aria-pressed={editorTab === 'design'} onClick={() => setEditorTab('design')}>디자인</button>
            </div>
            <div className="editor-controls">
              {editorTab === 'songs' ? <div className="editor-control-group">
                <div className="editor-heading"><h2>찬양 찾기</h2><span>{categories.songs}곡</span></div>
                <form className="editor-search" onSubmit={searchSongs}>
                  <label className="style-field"><span>곡 제목 또는 찬송가 번호</span><input autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목 또는 찬송가 번호" /></label>
                  <button className="btn btn--primary" type="submit" disabled={searching || !query.trim()}>{searching ? '통합 검색 중' : '곡 찾기'}</button>
                </form>
                {searchNotice && <p className={`notice ${searchNotice.kind ?? ''}`} role="status">{searchNotice.text}</p>}
                {providerInfo.length > 0 && <div className="result-list"><div className="result-heading">추가 곡 정보 · 가사 없음</div>{providerInfo.map((song, index) => <div className="result-row" key={`${song.source}-${index}`}><span className="result-main"><strong>{song.title}</strong><small>{song.artist} · {song.source}</small></span></div>)}</div>}
                {externalResults.length > 0 && <div className="result-list"><div className="result-heading">LRCLIB 검색 결과 <span>{externalResults.length}</span></div>{externalResults.map((song) => <button className={`result-row ${activeSong?.id === song.id ? 'is-active' : ''}`} key={song.id} type="button" onClick={() => setActiveSong(song)}><span className="result-main"><strong>{song.title}</strong><small>가수 {displayPerson(song.artist)} · 앨범 {displayPerson(song.album)}</small></span><span className="result-meta">→</span></button>)}</div>}
                {results.length > 0 && <div className="result-list" aria-live="polite"><div className="result-heading">검색 결과 <span>{results.length}</span></div>{results.map((song) => <button className={`result-row ${activeSong?.id === song.id ? 'is-active' : ''}`} key={song.id} type="button" onClick={() => setActiveSong(song)}><span className="result-main"><strong>{song.title}</strong><small>작사 {displayPerson(song.author)}</small></span><span className="result-meta" aria-hidden="true">→</span></button>)}</div>}
                {activeSong && <article className="song-detail" aria-live="polite"><div className="detail-title"><div><p className="eyebrow">선택한 찬양</p><h3>{activeSong.title}</h3></div><button className="icon-button" onClick={() => setActiveSong(null)} aria-label="선택한 곡 닫기">×</button></div><dl className="song-meta"><div><dt>작사</dt><dd>{displayPerson(activeSong.author)}</dd></div><div><dt>작곡</dt><dd>{displayPerson(activeSong.composer)}</dd></div><div><dt>공연팀</dt><dd>{displayPerson(activeSong.artist)}</dd></div></dl><div className="lyrics-preview"><span>가사 미리보기</span><p>{activeSong.id < 0 ? activeSong.lyrics?.trim() : activeSong.lyrics?.trim().slice(0, 520)}{activeSong.id > 0 && (activeSong.lyrics?.length ?? 0) > 520 ? '…' : ''}</p></div>{activeSong.id < 0 && <p className="editor-hint">LRCLIB 제공 가사입니다. 곡과 가사를 확인하고 이용 권한이 있는 경우에 사용해 주세요. DB에는 저장되지 않습니다.</p>}<button className="btn btn--secondary add-button" onClick={() => addSelection(activeSong)}>제작 목록에 추가</button></article>}
                <div className="editor-section"><div className="editor-heading"><h2>가사 등록 곡</h2><span>{filteredReady.length}곡</span></div><label className="style-field"><span className="visually-hidden">등록된 찬양 검색</span><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="등록된 곡 검색" /></label>
                  {loadingSongs ? <div className="empty-state">곡 목록을 불러오는 중입니다.</div> : libraryError ? <div className="empty-state empty-state--error">{libraryError}</div> : filteredReady.length === 0 ? <div className="empty-state">일치하는 곡이 없습니다.</div> : <div className="editor-library">{filteredReady.slice(0, 14).map((song) => <div className="library-row" key={song.id}><button className="library-title" type="button" onClick={() => addSelection(song)}><strong>{song.title}</strong><small>{song.category?.toUpperCase() === 'HYMN' && song.hymnNumber ? `새찬송가 ${song.hymnNumber}장` : 'CCM'} · 작사 {displayPerson(song.author)}</small></button><button className="add-mini" type="button" onClick={() => addSelection(song)} aria-label={`${song.title} 제작 목록에 추가`}>추가</button></div>)}</div>}
                </div>
                <div className="editor-section"><div className="editor-heading"><h2>선택한 곡</h2><span>{selected.length}곡</span></div>
                  {selected.length === 0 ? <p className="editor-hint">목록에서 곡을 추가해 주세요.</p> : <ol className="selected-list">{selected.map((song, index) => <li key={song.id}><span className="selected-index">{String(index + 1).padStart(2, '0')}</span><span className="selected-song"><strong>{song.title}</strong><small>{displayPerson(song.author)}</small></span><div className="selected-actions"><button type="button" onClick={() => moveSong(index, -1)} disabled={index === 0} aria-label={`${song.title} 위로`}>↑</button><button type="button" onClick={() => moveSong(index, 1)} disabled={index === selected.length - 1} aria-label={`${song.title} 아래로`}>↓</button><button type="button" onClick={() => setSelected((items) => items.filter((item) => item.id !== song.id))} aria-label={`${song.title} 제거`}>×</button></div></li>)}</ol>}
                </div>
                <div className="editor-section"><label className="file-field"><span>기존 PPTX에 이어 붙이기 <em>선택</em></span><input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(event) => setExistingPpt(event.target.files?.[0] ?? null)} /><small>{existingPpt ? `${existingPpt.name} · 새 슬라이드에만 디자인이 적용됩니다` : '기존 슬라이드 뒤에 추가합니다 · 최대 20MB'}</small></label></div>
                {pptNotice && <p className={`notice ${pptNotice.kind ?? ''}`} role="status" aria-live="polite">{pptNotice.text}</p>}
              </div> : <div className="editor-control-group design-controls">
                <div className="editor-heading"><h2>슬라이드 디자인</h2></div>
                <label className="style-field"><span>템플릿</span><select value={template} onChange={(event) => { const value = event.target.value; setTemplate(value); if (templateStyles[value]) setPptStyle({ ...templateStyles[value] }); }}><option value="original">기본 남색</option><option value="sky">맑은 하늘</option><option value="white">깔끔한 흰색</option><option value="black">선명한 검정</option><option value="custom">직접 설정</option></select></label>
                <div className="style-grid"><label className="style-field"><span>배경색</span><input type="color" value={pptStyle.backgroundColor} onChange={(event) => updateStyle({ backgroundColor: event.target.value })} /></label><label className="style-field"><span>글자색</span><input type="color" value={pptStyle.textColor} onChange={(event) => updateStyle({ textColor: event.target.value })} /></label><label className="style-field style-field--wide"><span>글꼴 이름</span><input type="text" maxLength={80} value={pptStyle.fontFamily} onChange={(event) => updateStyle({ fontFamily: event.target.value })} /></label><label className="style-field"><span>글자 크기</span><input type="number" min="16" max="100" value={pptStyle.fontSize || ''} onChange={(event) => updateStyle({ fontSize: Number(event.target.value) })} /></label><label className="style-field"><span>한 장의 줄 수</span><input type="number" min="1" max="6" value={pptStyle.linesPerSlide || ''} onChange={(event) => updateStyle({ linesPerSlide: Number(event.target.value) })} /></label><label className="style-field"><span>글자 정렬</span><select value={pptStyle.alignment} onChange={(event) => updateStyle({ alignment: event.target.value as PptStyle['alignment'] })}><option value="LEFT">왼쪽</option><option value="CENTER">가운데</option><option value="RIGHT">오른쪽</option></select></label><label className="style-check"><input type="checkbox" checked={pptStyle.bold} onChange={(event) => updateStyle({ bold: event.target.checked })} /> 굵게</label></div>
                {pptStyle.fontSize * pptStyle.linesPerSlide * 1.2 > 300 && <p className="style-hint">글자 크기와 줄 수가 크면 일부 가사가 잘릴 수 있습니다.</p>}
                <div className="editor-section"><label className="file-field"><span>배경 이미지 <em>선택</em></span><input key={imageInputKey} type="file" accept="image/png,image/jpeg" onChange={chooseBackground} /><small>{backgroundImage ? backgroundImage.name : 'PNG 또는 JPEG · 최대 5MB'}</small></label>{backgroundImage && <button type="button" className="clear-image" onClick={() => { setBackgroundImage(null); setImageInputKey((key) => key + 1); }}>배경 이미지 제거</button>}{backgroundImage && <p className="style-hint">이미지는 배경색 위에 슬라이드 크기로 늘어납니다.</p>}</div>
                {pptNotice && <p className={`notice ${pptNotice.kind ?? ''}`} role="status" aria-live="polite">{pptNotice.text}</p>}
              </div>}
            </div>
          </aside>
          <section className="editor-workspace" aria-labelledby="preview-title">
            <div className="editor-toolbar"><div><p className="editor-kicker">미리보기</p><h2 id="preview-title">{selected.length ? '선택한 찬양 슬라이드' : '찬양 슬라이드'}</h2></div><span className="editor-page-count">{preview ? `${preview.slideIndex + 1} / ${preview.slideCount}` : '— / —'}</span></div>
            <div className="editor-stage">
              <div className={`editor-canvas ${preview && !previewLoading && !previewError ? 'has-preview' : ''}`} aria-live="polite">
                {preview && !previewLoading && !previewError ? <img src={`data:image/png;base64,${preview.imageBase64}`} alt={`${preview.slideIndex + 1}번째 슬라이드 미리보기`} /> : <div className="editor-canvas-message">{previewLoading ? <><span className="preview-spinner" aria-hidden="true" /><strong>슬라이드를 불러오는 중</strong></> : previewError ? <><strong>미리보기를 열 수 없습니다</strong><span>{previewError}</span><button type="button" className="preview-retry" onClick={() => setPreviewRetry((value) => value + 1)}>다시 시도</button></> : <><strong>곡을 추가해 보세요</strong><span>선택한 찬양이 여기에 표시됩니다.</span></>}</div>}
              </div>
            </div>
            <div className="editor-bottom"><div className="slide-navigation" aria-label="슬라이드 이동"><button type="button" onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))} disabled={!preview || previewLoading || preview.slideIndex === 0} aria-label="이전 슬라이드">←</button><span>{preview ? `${preview.slideIndex + 1} / ${preview.slideCount}` : '0 / 0'}</span><button type="button" onClick={() => setPreviewIndex((index) => index + 1)} disabled={!preview || previewLoading || preview.slideIndex >= preview.slideCount - 1} aria-label="다음 슬라이드">→</button></div><p>서버의 글꼴로 표시합니다. 다른 기기의 글꼴과 기존 PPT의 일부 효과는 다르게 보일 수 있습니다.</p><button className="btn btn--primary editor-download" type="button" onClick={createPpt} disabled={creating || !selected.length}>{creating ? '만드는 중…' : 'PPTX 다운로드'}</button></div>
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
      {page === 'manage' && <footer className="app-footer closing"><span>찬양 PPT</span><span>예배 자료 제작 도구</span><a className="link" href="#create">PPT 제작</a></footer>}
    </>
  );
}
