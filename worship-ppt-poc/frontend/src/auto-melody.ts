import { useEffect, useMemo, useRef, useState } from 'react';
import type { MelodyNote } from './score';

export type AutoMelody = {
  title: string;
  sourceType?: string;
  sourcePage?: string;
  sourceFileUrl?: string;
  sourceFileType?: string;
  sheetImages?: string[];
  sheetImageCount?: number;
  musicxmlUrl?: string;
  bpm: number;
  key?: string | null;
  lyricsStart?: number | null;
  videoId?: string | null;
  vocalStartSec: number;
  vocalEndSec: number;
  notes: MelodyNote[];
  jobId: string;
  revision: number;
  reviewed: boolean;
};
type Song = { id: number; title: string; artist: string | null; source?: string | null; youtubeVideoId?: string | null };
type Job = {
  jobId: string;
  state: 'queued' | 'running' | 'ready' | 'failed';
  error?: string;
  revision?: number;
  score?: {
    sourceType?: string;
    sourcePage?: string;
    sourceFileUrl?: string;
    sourceFileType?: string;
    sourceAlternatives?: Array<{ sourcePage: string; sourceFileUrl: string; sourceFileType: string }>;
    sheetImages?: string[];
    sheetImageCount?: number;
    musicxmlUrl?: string;
    bpm: number;
    key?: string | null;
    lyricsStart?: number | null;
    videoId?: string | null;
    vocalStartSec?: number;
    vocalEndSec?: number;
    reviewed: boolean;
    notes: Array<{ pitch: number; startTime: number; duration: number; amplitude: number; beats?: number }>;
  };
};
const normalize = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
function songVideoId(song: Song) {
  if (song.youtubeVideoId && /^[A-Za-z0-9_-]{11}$/.test(song.youtubeVideoId)) return song.youtubeVideoId;
  if (!song.source) return undefined;
  try {
    const url = new URL(song.source);
    const videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : undefined;
  } catch { return undefined; }
}
const melodyKey = (song: Song) => JSON.stringify([normalize(song.title), normalize(song.artist ?? ''), songVideoId(song) ?? '']);
type MelodyStatus = { state: 'loading' | 'waiting' | 'failed'; message: string };
const jobsUrl = '/api/auto-melody/jobs';

async function fetchJob(url: string, init?: RequestInit): Promise<Job> {
  const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(55_000) });
  if (response.status === 413) throw new Error('파일 또는 악보 데이터가 너무 큽니다.');
  if (response.status === 409) throw new Error('이미 새 수정본이 저장됐습니다. 악보를 다시 열어 주세요.');
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { error?: unknown; detail?: unknown } | null;
    const message = problem?.error ?? problem?.detail;
    throw new Error(typeof message === 'string' ? message : '악보 서버에 연결하지 못했습니다.');
  }
  return response.json();
}

async function fetchSheetImage(jobId: string, index: number) {
  const response = await fetch(`${jobsUrl}/${jobId}/slides/${index}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('악보 PPT 페이지를 불러오지 못했습니다.');
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('악보 이미지를 읽지 못했습니다.'));
    reader.onerror = () => reject(new Error('악보 이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

async function fetchPresentationFile(url: string) {
  const chunkSize = 3 * 1024 * 1024;
  const first = await fetch(url, {
    headers: { Range: `bytes=0-${chunkSize - 1}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!first.ok) {
    const problem = await first.json().catch(() => null) as { error?: unknown } | null;
    const message = problem?.error;
    throw new Error(typeof message === 'string' ? message : '원본 악보 파일을 다운로드하지 못했습니다.');
  }
  const contentType = first.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  if (first.status !== 206) {
    const blob = await first.blob();
    if (blob.size > 20 * 1024 * 1024) throw new Error('악보 PPT 파일이 너무 큽니다.');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType };
  }

  const contentRange = first.headers.get('content-range')?.match(/^bytes 0-(\d+)\/(\d+)$/);
  const firstBytes = new Uint8Array(await first.arrayBuffer());
  const firstEnd = Number(contentRange?.[1]);
  const fileSize = Number(contentRange?.[2]);
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > 20 * 1024 * 1024
      || !Number.isInteger(firstEnd) || firstEnd < 0 || firstEnd >= fileSize
      || firstBytes.length !== firstEnd + 1) throw new Error('악보 PPT 파일 크기를 확인할 수 없습니다.');
  const bytes = new Uint8Array(fileSize);
  bytes.set(firstBytes, 0);
  for (let start = firstBytes.length; start < fileSize; start += chunkSize * 3) {
    const ranges = Array.from({ length: Math.min(3, Math.ceil((fileSize - start) / chunkSize)) }, (_, index) => {
      const rangeStart = start + index * chunkSize;
      return [rangeStart, Math.min(fileSize - 1, rangeStart + chunkSize - 1)] as const;
    });
    const chunks = await Promise.all(ranges.map(async ([rangeStart, rangeEnd]) => {
      const response = await fetch(url, {
        headers: { Range: `bytes=${rangeStart}-${rangeEnd}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok || response.status !== 206) throw new Error('악보 PPT 페이지 데이터를 받지 못했습니다.');
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length !== rangeEnd - rangeStart + 1) throw new Error('악보 PPT 페이지 데이터가 일부 누락됐습니다.');
      return { start: rangeStart, data };
    }));
    for (const chunk of chunks) bytes.set(chunk.data, chunk.start);
  }
  return { bytes, contentType };
}

async function imageFromBlob(blob: Blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context: CanvasRenderingContext2D) => context.drawImage(bitmap, 0, 0),
      dispose: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('악보 페이지 이미지를 열지 못했습니다.'));
      image.src = url;
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    draw: (context: CanvasRenderingContext2D) => context.drawImage(image, 0, 0),
    dispose: () => URL.revokeObjectURL(url),
  };
}

function containsStaff(canvas: HTMLCanvasElement) {
  const width = Math.min(1200, canvas.width);
  const height = Math.max(1, Math.round(canvas.height * width / canvas.width));
  if (height < 20) return false;
  const probe = document.createElement('canvas');
  probe.width = width;
  probe.height = height;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(canvas, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const darkRows: number[] = [];
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const gray = (pixels[offset] * 299 + pixels[offset + 1] * 587 + pixels[offset + 2] * 114) / 1000;
      if (gray < 110) dark++;
    }
    if (dark / width > 0.15) darkRows.push(y);
  }
  const bands: number[] = [];
  for (let index = 0; index < darkRows.length;) {
    let end = index;
    while (end + 1 < darkRows.length && darkRows[end + 1] - darkRows[end] <= 1) end++;
    if (end - index <= 3) bands.push((darkRows[index] + darkRows[end]) / 2);
    index = end + 1;
  }
  for (let start = 0; start + 4 < bands.length; start++) {
    const gaps = bands.slice(start, start + 5).slice(1).map((value, index) => value - bands[start + index]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const spacing = sorted[2];
    if (spacing >= 4 && spacing <= 45 && gaps.every(gap => Math.abs(gap - spacing) <= 1.8)) return true;
  }
  return false;
}

async function renderPresentationFile(sourceUrl: string, sourceFileType?: string) {
  const { bytes, contentType } = await fetchPresentationFile(sourceUrl);
  if (['png', 'jpg', 'jpeg', 'webp'].includes((sourceFileType || '').toLowerCase()) || contentType.startsWith('image/')) {
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType.startsWith('image/') ? contentType : `image/${sourceFileType === 'jpg' ? 'jpeg' : sourceFileType}` });
    const image = await imageFromBlob(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('악보 페이지를 표시할 수 없습니다.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      image.draw(context);
      if (!containsStaff(canvas)) throw new Error('찾은 이미지에서 악보 오선을 확인하지 못했습니다.');
      return [canvas.toDataURL('image/jpeg', 0.92)];
    } finally {
      image.dispose();
    }
  }
  try {
    const { parse, slideToPng } = await import('@web-ppt/core');
    const presentation = await parse(bytes);
    try {
      if (!presentation.slides.length || presentation.slides.length > 40) throw new Error('악보 PPT의 페이지 수를 지원하지 않습니다.');
      const canvas = document.createElement('canvas');
      const slides: string[] = [];
      let hasScore = false;
      const scale = Math.min(1600 / presentation.width, 2);
      for (const slide of presentation.slides) {
        const blob = await slideToPng(presentation, slide, scale);
        const image = await imageFromBlob(blob);
        try {
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('악보 페이지를 표시할 수 없습니다.');
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          image.draw(context);
          hasScore ||= containsStaff(canvas);
          slides.push(canvas.toDataURL('image/jpeg', 0.91));
        } finally {
          image.dispose();
        }
      }
      if (!hasScore) throw new Error('찾은 PPT에서 악보 오선을 확인하지 못했습니다.');
      return slides;
    } finally {
      presentation.dispose?.();
    }
  } catch (error) {
    if (error instanceof Error && (error.message.includes('악보 PPT') || error.message.includes('찾은 PPT'))) throw error;
    throw new Error('원본 악보 PPT를 미리보기로 변환하지 못했습니다.');
  }
}

async function readScore(title: string, job: Job): Promise<AutoMelody> {
  const payload = job.score;
  if ((!payload?.notes.length && !payload?.sheetImages?.length && !payload?.sheetImageCount && !payload?.sourceFileUrl) || !job.revision) throw new Error('악보 결과가 비어 있습니다.');
  let sheetImages = payload?.sheetImages;
  let sourcePage = payload?.sourcePage;
  let sourceFileUrl = payload?.sourceFileUrl;
  let sourceFileType = payload?.sourceFileType;
  if (!sheetImages && payload?.sourceFileUrl) {
    const sources: Array<{ sourcePage?: string; sourceFileUrl: string; sourceFileType?: string }> = [
      { sourceFileUrl: payload.sourceFileUrl, sourceFileType: payload.sourceFileType },
      ...(payload.sourceAlternatives || []),
    ];
    let lastError: unknown;
    for (const source of sources) {
      try {
        sheetImages = await renderPresentationFile(source.sourceFileUrl, source.sourceFileType);
        sourcePage = source.sourcePage ?? sourcePage;
        sourceFileUrl = source.sourceFileUrl;
        sourceFileType = source.sourceFileType;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!sheetImages && lastError instanceof Error) throw lastError;
  }
  if (!sheetImages && payload?.sheetImageCount) {
    if (payload.sheetImageCount > 40) throw new Error('악보 PPT 페이지 수가 너무 많습니다.');
    sheetImages = [];
    for (let start = 0; start < payload.sheetImageCount; start += 5) {
      sheetImages.push(...await Promise.all(Array.from(
        { length: Math.min(5, payload.sheetImageCount - start) }, (_, offset) => fetchSheetImage(job.jobId, start + offset),
      )));
    }
  }
  return {
    title, sheetImages, sourceType: payload.sourceType,
    sourcePage, sourceFileUrl, sourceFileType,
    musicxmlUrl: payload.musicxmlUrl, jobId: job.jobId, revision: job.revision, reviewed: payload.reviewed,
    bpm: payload.bpm, key: payload.key, lyricsStart: payload.lyricsStart, videoId: payload.videoId,
    vocalStartSec: payload.vocalStartSec ?? 0, vocalEndSec: payload.vocalEndSec ?? 0,
    notes: payload.notes.map(note => ({
      pitchMidi: note.pitch, startTimeSeconds: note.startTime, durationSeconds: note.duration,
      amplitude: note.amplitude, beats: note.beats,
    })),
  };
}

export async function getVocalBounds(song: Song, requestedVideoId?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ title: song.title.trim(), artist: (song.artist ?? '').trim().slice(0, 120) });
  const exactVideoId = requestedVideoId || songVideoId(song);
  if (exactVideoId && /^[A-Za-z0-9_-]{11}$/.test(exactVideoId)) query.set('video_id', exactVideoId);
  const requestSignal = signal ?? AbortSignal.timeout(210_000);
  let job = await fetchJob(`${jobsUrl}?${query}`, { method: 'POST', signal: requestSignal });
  while (job.state === 'queued' || job.state === 'running') {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(requestSignal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const timer = window.setTimeout(() => {
        requestSignal.removeEventListener('abort', onAbort);
        resolve();
      }, 2500);
      if (requestSignal.aborted) onAbort();
      else requestSignal.addEventListener('abort', onAbort, { once: true });
    });
    job = await fetchJob(`${jobsUrl}/${job.jobId}`, { signal: requestSignal });
  }
  if (job.state === 'failed') throw new Error(job.error || '보컬 구간을 분석하지 못했습니다.');
  const start = job.score?.vocalStartSec;
  const end = job.score?.vocalEndSec;
  const videoId = job.score?.videoId;
  if (typeof start !== 'number' || typeof end !== 'number' || end <= start
      || typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error('실제 가창 구간을 확인하지 못해 자막을 가사로 사용할 수 없습니다.');
  }
  return { vocalStartSec: start, vocalEndSec: end, videoId };
}

async function requestMelody(song: Song, onWaiting: (waiting: boolean) => void, isWanted: () => boolean, file?: File) {
  const query = new URLSearchParams({ title: song.title.trim(), artist: (song.artist ?? '').trim().slice(0, 120) });
  const videoId = songVideoId(song);
  if (videoId) query.set('video_id', videoId);
  const route = file ? `${jobsUrl}/upload` : jobsUrl;
  let job = await fetchJob(`${route}?${query}`, { method: 'POST', body: file });
  while (job.state === 'queued' || job.state === 'running') {
    onWaiting(job.state === 'queued');
    await new Promise(resolve => window.setTimeout(resolve, 4000));
    if (!isWanted()) return undefined;
    job = await fetchJob(`${jobsUrl}/${job.jobId}`);
  }
  if (job.state === 'failed') throw new Error(job.error || '악보 분석에 실패했습니다.');
  return readScore(song.title, job);
}

export async function uploadMelody(song: Song, file: File, onWaiting: (waiting: boolean) => void) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('20MB 이하 음원 파일을 선택해 주세요.');
  const result = await requestMelody(song, onWaiting, () => true, file);
  if (!result) throw new Error('음원 분석을 완료하지 못했습니다.');
  return result;
}

export async function saveAutoMelody(melody: AutoMelody, notes: MelodyNote[], key: string | null, lyricsStart: number) {
  const job = await fetchJob(`${jobsUrl}/${melody.jobId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revision: melody.revision, key, lyricsStart,
      notes: notes.map(note => ({
        pitch: note.pitchMidi, startTime: note.startTimeSeconds, duration: note.durationSeconds,
        amplitude: note.amplitude, beats: note.beats,
      })),
    }),
  });
  return readScore(melody.title, job);
}

export async function reloadAutoMelody(melody: AutoMelody) {
  return readScore(melody.title, await fetchJob(`${jobsUrl}/${melody.jobId}`));
}

export function useAutoMelodies(selected: Song[]) {
  const [melodiesByTitle, setMelodiesByTitle] = useState(new Map<string, AutoMelody>());
  const [statuses, setStatuses] = useState(new Map<string, MelodyStatus>());
  const requested = useRef(new Set<string>());
  const wanted = useRef(new Set<string>());

  useEffect(() => {
    const candidates = selected.filter(song => song.source !== 'audio-upload');
    wanted.current = new Set(candidates.map(song => melodyKey(song)));
    for (const song of candidates) {
      const key = melodyKey(song);
      if (!song.title.trim() || requested.current.has(key) || statuses.get(key)?.state === 'failed' || melodiesByTitle.has(key)) continue;
      requested.current.add(key);
      const setStatus = (status: MelodyStatus) => setStatuses(items => new Map(items).set(key, status));
      setStatus({ state: 'loading', message: '악보 이미지를 찾는 중입니다.' });
      void requestMelody(song, waiting => setStatus(waiting
        ? { state: 'waiting', message: '분석 대기 중입니다. 차례가 되면 자동으로 시작합니다.' }
        : { state: 'loading', message: '예배용 악보 슬라이드를 불러오는 중입니다.' }
      ), () => wanted.current.has(key)).then(melody => {
        if (melody === undefined) {
          requested.current.delete(key);
          return;
        }
        if (!melody) throw new Error('이 음원에서 악보를 만들 수 있는 음표를 찾지 못했습니다.');
        setMelodiesByTitle(items => items.has(key) ? items : new Map(items).set(key, melody));
      }).catch(error => {
        const message = error instanceof DOMException && error.name === 'TimeoutError'
          ? '악보 분석 응답 시간이 초과됐습니다.'
          : error instanceof Error && !(error instanceof TypeError) ? error.message : '악보 분석 서버에 연결하지 못했습니다.';
        setStatus({ state: 'failed', message });
      }).finally(() => {
        setStatuses(items => {
          if (items.get(key)?.state === 'failed') return items;
          const next = new Map(items);
          next.delete(key);
          return next;
        });
      });
    }
  }, [selected, melodiesByTitle, statuses]);

  const melodies = useMemo(() => Object.fromEntries(selected.flatMap(song => {
    const melody = melodiesByTitle.get(melodyKey(song));
    return melody ? [[song.id, { ...melody, title: song.title }]] : [];
  })), [selected, melodiesByTitle]);

  function retry(song: Song) {
    const key = melodyKey(song);
    if (statuses.get(key)?.state !== 'failed') return;
    requested.current.delete(key);
    setStatuses(items => {
      const next = new Map(items);
      next.delete(key);
      return next;
    });
  }

  return {
    melodies,
    statusFor: (song: Song) => statuses.get(melodyKey(song)),
    scoreFor: (song: Song) => melodiesByTitle.get(melodyKey(song)),
    updateScore: (song: Song, score: AutoMelody) => setMelodiesByTitle(items => new Map(items).set(melodyKey(song), score)),
    retry,
  };
}
