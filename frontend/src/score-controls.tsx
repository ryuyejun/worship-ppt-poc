import { useState } from 'react';
import { makeScoreSlides } from './score';
import type { ScoreSlide } from './score';
import { readMidi } from './midi';
import type { MidiMatch, MidiScore } from './midi';

export function ScoreControls({ title, lyrics, staffColor = '#ffffff', onGenerated, onAudio }: {
  title: string;
  lyrics: string;
  staffColor?: string;
  onGenerated: (title: string, slides: ScoreSlide[]) => void;
  onAudio: (file: File, onWaiting: (waiting: boolean) => void) => Promise<void>;
}) {
  const [midi, setMidi] = useState<MidiScore | null>(null);
  const [matches, setMatches] = useState<MidiMatch[]>([]);
  const [trackIndex, setTrackIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function generateFromMidi(score: MidiScore, track = 0) {
    if (!lyrics.trim()) { setError('먼저 가사가 있는 곡을 선택해 주세요.'); return; }
    setBusy(true); setError(''); setStatus('악보를 현재 PPT에 넣고 있습니다.');
    try {
      const slides = await makeScoreSlides(title || score.title, lyrics, score.tracks[track].notes, score.bpm, staffColor);
      onGenerated(title || score.title, slides);
      setStatus('악보를 PPT 미리보기에 넣었습니다.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '악보를 만들지 못했습니다.');
      setStatus('');
    } finally { setBusy(false); }
  }

  async function findMidi() {
    if (!title.trim()) { setStatus('곡을 먼저 선택해 주세요.'); return; }
    setBusy(true); setError(''); setMatches([]); setMidi(null); setStatus('제목으로 MIDI를 찾고 있습니다.');
    try {
      const query = new URLSearchParams({ title: title.trim() });
      const response = await fetch(`/api/midi/search?${query}`);
      if (!response.ok) throw new Error('MIDI 검색에 실패했습니다.');
      const { data } = await response.json() as { data: MidiMatch[] };
      setMatches(data);
      if (!data.length) setStatus('이 곡의 MIDI를 찾지 못했습니다. 음원이나 MIDI 파일을 불러오면 현재 PPT에 바로 넣을 수 있습니다.');
      else {
        setStatus(`${data[0].title} MIDI를 찾았습니다. 악보를 만들고 있습니다.`);
        setMidi(data[0]); setTrackIndex(0);
        await generateFromMidi(data[0]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'MIDI 검색에 실패했습니다.');
      setStatus('');
    } finally { setBusy(false); }
  }

  async function loadMidiFile(file: File) {
    try {
      if (file.size > 1_000_000) throw new Error('1MB 이하의 MIDI 파일을 선택해 주세요.');
      const score = readMidi(new Uint8Array(await file.arrayBuffer()));
      setMidi(score); setMatches([]); setTrackIndex(0);
      await generateFromMidi(score);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'MIDI 파일을 읽지 못했습니다.'); }
  }

  async function loadAudioFile(file: File) {
    if (!lyrics.trim()) { setError('먼저 가사가 있는 곡을 선택해 주세요.'); return; }
    setBusy(true); setError(''); setStatus('음원에서 멜로디를 분석하고 있습니다. 처음에는 모델을 불러오느라 잠시 걸릴 수 있습니다.');
    try {
      await onAudio(file, waiting => setStatus(waiting ? '음원 분석 대기 중입니다.' : '서버에서 보컬과 주선율을 분석하고 있습니다.'));
      setStatus('악보를 PPT 미리보기에 넣었습니다.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '음원에서 멜로디를 분석하지 못했습니다.');
      setStatus('');
    } finally { setBusy(false); }
  }

  return <div className="score-controls">
    <p className="score-controls__title">{title || '곡을 선택해 주세요'}</p>
    <p className="score-controls__hint">제작 목록에 추가한 곡의 멜로디를 자동으로 찾습니다.</p>
    <button type="button" className="file-picker-button" disabled={busy || !title.trim() || !lyrics.trim()} onClick={() => void findMidi()}>MIDI 검색</button>
    {midi?.tracks.length && midi.tracks.length > 1 ? <label className="score-controls__field">MIDI 트랙<select disabled={busy} value={trackIndex} onChange={event => { const index = Number(event.target.value); setTrackIndex(index); void generateFromMidi(midi, index); }}>{midi.tracks.map((track, index) => <option key={index} value={index}>{track.label}</option>)}</select></label> : null}
    {matches.length > 1 && <label className="score-controls__field">MIDI 곡<select disabled={busy} value={matches[0].id} onChange={event => { const match = matches.find(item => item.id === event.target.value); if (match) { setMidi(match); setTrackIndex(0); void generateFromMidi(match); } }}>{matches.map(match => <option key={match.id} value={match.id}>{match.title}</option>)}</select></label>}
    <label className="file-field score-controls__file"><span className="file-picker-button">MIDI 파일 불러오기</span><input type="file" accept=".mid,.midi,audio/midi,audio/x-midi" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadMidiFile(file); }} /><small>.mid 또는 .midi</small></label>
    <label className="file-field score-controls__file"><span className="file-picker-button">음원에서 멜로디 분석</span><input type="file" accept="audio/*,.wav,.mp3,.m4a,.flac" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadAudioFile(file); }} /><small>음원 파일에서 음표를 찾아 현재 슬라이드에 넣습니다.</small></label>
    <p className="score-controls__status" role="status" aria-live="polite">{busy && !status ? '처리 중…' : status}</p>
    {error && <p className="score-controls__error" role="alert">{error}</p>}
  </div>;
}
