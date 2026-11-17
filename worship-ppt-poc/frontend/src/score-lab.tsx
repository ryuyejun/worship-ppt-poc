import { useState } from 'react';
import { analyzeMelody, downloadScore, makeScoreSlides, sampleLyrics } from './score';
import type { MelodyNote, ScoreSlide } from './score';
import type { MidiMatch, MidiScore } from './midi';

export function ScoreLab({ initialTitle = '', initialLyrics = '', onBack, onApply }: {
  initialTitle?: string; initialLyrics?: string; onBack?: () => void; onApply?: (slides: ScoreSlide[]) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [lyrics, setLyrics] = useState(initialLyrics);
  const [file, setFile] = useState<File | null>(null);
  const [matches, setMatches] = useState<MidiMatch[]>([]);
  const [midi, setMidi] = useState<MidiScore | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [notes, setNotes] = useState<MelodyNote[]>([]);
  const [slides, setSlides] = useState<ScoreSlide[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(0);
  const slide = slides[index];

  async function generate(mode: 'file' | 'sample' | 'refresh' | 'midi', score = midi, selectedTrack = trackIndex) {
    setBusy(true);
    setError('');
    setSlides([]);
    const started = performance.now();
    try {
      const isSample = mode === 'sample';
      const nextTitle = isSample ? '반짝반짝 작은 별' : mode === 'midi' ? score!.title.trim() || title.trim() || '찬양 악보' : title.trim() || '찬양 악보';
      const nextLyrics = isSample ? sampleLyrics : lyrics;
      const nextBpm = isSample ? 120 : mode === 'midi' ? score!.bpm : bpm;
      if (!Number.isFinite(nextBpm) || nextBpm < 30 || nextBpm > 300) throw new Error('템포는 30~300 BPM 사이로 입력해 주세요.');
      if (mode !== 'refresh') setNotes([]);
      if (mode === 'file' || mode === 'sample') setMidi(null);
      setProgress(mode === 'refresh' ? '악보를 그리고 있습니다.' : '음원을 준비하고 있습니다.');
      const melody = mode === 'midi' ? score!.tracks[selectedTrack].notes : mode === 'refresh' ? notes : await analyzeMelody(isSample ? null : file, value => {
        setProgress(`멜로디 분석 중 · ${Math.round(value * 100)}%`);
      });
      if (isSample) {
        setTitle(nextTitle);
        setLyrics(nextLyrics);
        setBpm(nextBpm);
      }
      if (mode === 'midi') { setTitle(nextTitle); setBpm(nextBpm); }
      setNotes(melody);
      setProgress('악보를 그리고 있습니다.');
      setSlides(await makeScoreSlides(nextTitle, nextLyrics, melody, nextBpm));
      setIndex(0);
      setDuration((performance.now() - started) / 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '악보를 만들지 못했습니다.');
    } finally {
      setProgress('');
      setBusy(false);
    }
  }

  async function searchMidi() {
    setBusy(true);
    setError('');
    setMatches([]);
    setProgress('MIDI를 찾고 있습니다.');
    try {
      const query = new URLSearchParams({ title: title.trim() });
      const response = await fetch(`/api/midi/search?${query}`);
      if (!response.ok) throw new Error('MIDI 검색을 불러오지 못했습니다. MIDI 파일을 직접 열 수 있습니다.');
      const { data } = await response.json() as { data: MidiMatch[] };
      setMatches(data);
      if (!data.length) setProgress('등록된 MIDI가 없습니다. 음원 파일이나 MIDI 파일을 불러와 주세요.');
      else setProgress('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'MIDI 검색에 실패했습니다.');
      setProgress('');
    } finally {
      setBusy(false);
    }
  }

  function openMidi(score: MidiScore) {
    setMidi(score);
    setTrackIndex(0);
    void generate('midi', score, 0);
  }

  async function openMidiFile(file: File) {
    setBusy(true);
    setError('');
    try {
      if (file.size > 1_000_000) throw new Error('1MB 이하의 MIDI 파일을 선택해 주세요.');
      const { readMidi } = await import('./midi');
      openMidi(readMidi(new Uint8Array(await file.arrayBuffer())));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'MIDI 파일을 읽지 못했습니다.');
      setBusy(false);
    }
  }

  return <main className="score-lab">
    {onBack ? <button type="button" className="btn btn--secondary" onClick={onBack}>← PPT 제작</button> : <a href="./" className="btn btn--secondary">← PPT 제작</a>}
    <h1>악보 만들기</h1>
    <p>MIDI나 음원으로 멜로디를 불러와 가사와 함께 PPT를 만드세요.</p>
    <div className="score-lab__layout">
      <form onSubmit={event => { event.preventDefault(); if (file) void generate('file'); }}>
        <fieldset disabled={busy}>
          <label>곡 제목<input value={title} maxLength={120} onChange={event => { setTitle(event.target.value); setMatches([]); setSlides([]); setProgress(''); }} /></label>
          <button type="button" className="btn btn--secondary" disabled={!title.trim()} onClick={() => void searchMidi()}>제목으로 MIDI 찾기</button>
          {matches.length > 0 && <ul className="score-lab__matches">
            {matches.map(match => <li key={match.id}>
              <button type="button" className="btn btn--secondary" onClick={() => openMidi(match)}>{match.title} 불러오기</button>
              <a href={match.sourceUrl} target="_blank" rel="noreferrer">CCEL 출처</a>
            </li>)}
          </ul>}
          <label>MIDI 파일<input type="file" accept=".mid,.midi,audio/midi,audio/x-midi" onChange={event => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (selected) void openMidiFile(selected);
          }} /></label>
          {midi && <label>MIDI 트랙<select value={trackIndex} onChange={event => {
            const selected = Number(event.target.value);
            setTrackIndex(selected);
            void generate('midi', midi, selected);
          }}>
            {midi.tracks.map((track, i) => <option key={i} value={i}>{track.label}</option>)}
          </select><small>한 트랙에서 동시에 시작하는 음 중 가장 높은 음을 표시합니다.</small></label>}
          <label>음원 파일<input type="file" accept="audio/*,.wav,.mp3,.m4a,.flac" onChange={event => {
            setFile(event.target.files?.[0] ?? null); setNotes([]); setSlides([]); setError('');
          }} /></label>
          <label>가사<textarea rows={7} maxLength={12000} value={lyrics} onChange={event => { setLyrics(event.target.value); setSlides([]); }} /></label>
          <small>줄 시작에 [00:04.00]처럼 시간을 넣으면 해당 구간의 음표를 붙입니다. 시간이 없으면 가사 줄 길이에 따라 음표를 나눕니다.</small>
          <label>템포 (BPM)<input type="number" min={30} max={300} value={bpm || ''} onChange={event => { setBpm(Number(event.target.value)); setSlides([]); }} /></label>
          <div className="score-lab__actions">
            <button type="submit" className="btn btn--primary" disabled={!file}>음원 분석</button>
            <button type="button" className="btn btn--secondary" onClick={() => void generate('sample')}>예제로 시험</button>
            {notes.length > 0 && <button type="button" className="btn btn--secondary" onClick={() => void generate('refresh')}>악보 다시 그리기</button>}
          </div>
        </fieldset>
        <p role="status">{progress}</p>
        {error && <p role="alert">{error}</p>}
      </form>
      <section aria-label="악보 미리보기">
        <h2>미리보기</h2>
        {slide ? <>
          <div className="score-lab__slide">
            <strong>{slide.title}</strong>
            {slide.rows.map((row, i) => <div key={i} className="score-lab__row">
              {row.staff ? <img src={row.staff} alt={`${i + 1}번째 오선 악보`} /> : <div className="score-lab__empty-staff" />}
              <div>{row.lyrics}</div>
            </div>)}
          </div>
          <div className="score-lab__actions">
            {onApply && <button type="button" className="btn btn--secondary" onClick={() => onApply(slides)}>Yebit 슬라이드에 적용</button>}
            <button type="button" className="btn btn--secondary" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="이전 장">←</button>
            <span>{index + 1} / {slides.length}</span>
            <button type="button" className="btn btn--secondary" disabled={index + 1 >= slides.length} onClick={() => setIndex(index + 1)} aria-label="다음 장">→</button>
            <button type="button" className="btn btn--primary" onClick={() => void downloadScore(slides).catch(() => setError('PPTX를 저장하지 못했습니다.'))}>악보 PPTX 다운로드</button>
          </div>
          <p>음표 {notes.length}개 · {duration.toFixed(1)}초 소요</p>
        </> : <div className="score-lab__placeholder">MIDI나 음원을 불러오면 여기에 악보가 표시됩니다.</div>}
      </section>
    </div>
  </main>;
}
