import { useEffect, useMemo, useRef, useState } from 'react';
import type { MelodyNote } from './score';

export type AutoMelody = {
  title: string;
  sourceType?: string;
  sourcePage?: string;
  sheetImages?: string[];
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
    sheetImages?: string[];
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
  const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });
  if (response.status === 413) throw new Error('파일 또는 악보 데이터가 너무 큽니다.');
  if (response.status === 409) throw new Error('이미 새 수정본이 저장됐습니다. 악보를 다시 열어 주세요.');
  if (!response.ok) throw new Error('악보 서버에 연결하지 못했습니다.');
  return response.json();
}

function readScore(title: string, job: Job): AutoMelody {
  const payload = job.score;
  if ((!payload?.notes.length && !payload?.sheetImages?.length) || !job.revision) throw new Error('악보 결과가 비어 있습니다.');
  return {
    title, sheetImages: payload.sheetImages, sourceType: payload.sourceType, sourcePage: payload.sourcePage, musicxmlUrl: payload.musicxmlUrl, jobId: job.jobId, revision: job.revision, reviewed: payload.reviewed,
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

export function useAutoMelodies(selected: Song[], candidate: Song | null) {
  const [melodiesByTitle, setMelodiesByTitle] = useState(new Map<string, AutoMelody>());
  const [statuses, setStatuses] = useState(new Map<string, MelodyStatus>());
  const requested = useRef(new Set<string>());
  const wanted = useRef(new Set<string>());

  useEffect(() => {
    const candidates = (candidate ? [candidate, ...selected] : selected).filter(song => song.source !== 'audio-upload');
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
  }, [selected, candidate, melodiesByTitle, statuses]);

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
