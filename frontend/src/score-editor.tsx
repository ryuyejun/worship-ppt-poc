import { useEffect, useRef, useState } from 'react';
import { reloadAutoMelody, saveAutoMelody, type AutoMelody } from './auto-melody';
import { renderAutoScoreRows } from './score';

const PAGE_SIZE = 12;
const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
const BEATS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

export function ScoreEditor({ initial, onSave, onClose }: {
  initial: AutoMelody;
  onSave: (score: AutoMelody) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ index: number; y: number; pitch: number } | null>(null);
  const [source, setSource] = useState(initial);
  const [notes, setNotes] = useState(initial.notes);
  const [key, setKey] = useState(initial.key ?? '');
  const [lyricsStart, setLyricsStart] = useState(initial.lyricsStart ?? 0);
  const [selected, setSelected] = useState(0);
  const [image, setImage] = useState('');
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const page = Math.floor(selected / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const note = notes[selected];
  const canLowerOctave = notes.every(item => item.pitchMidi >= 12);
  const canRaiseOctave = notes.every(item => item.pitchMidi <= 115);
  const beats = note.beats ?? note.durationSeconds * source.bpm / 60;
  const currentBeat = BEATS.reduce((best, value) => Math.abs(value - beats) < Math.abs(best - beats) ? value : best);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let current = true;
    const row = { lyrics: '', notes: notes.slice(start, start + PAGE_SIZE) };
    void renderAutoScoreRows([row], source.bpm, '#16233b', key || undefined)
      .then(result => { if (current) setImage(result[0]?.staff ?? ''); })
      .catch(() => { if (current) setImage(''); });
    return () => { current = false; };
  }, [notes, start, source.bpm, key]);

  function changePitch(index: number, pitch: number) {
    setNotes(items => items.map((item, i) => i === index ? { ...item, pitchMidi: Math.min(127, Math.max(0, pitch)) } : item));
    setChanged(true);
  }

  function transposeOctave(direction: -1 | 1) {
    if (direction === -1 ? !canLowerOctave : !canRaiseOctave) return;
    setNotes(items => items.map(item => ({ ...item, pitchMidi: item.pitchMidi + direction * 12 })));
    setChanged(true);
  }

  function changeBeats(value: number) {
    const duration = value * 60 / source.bpm;
    const shift = duration - note.durationSeconds;
    setNotes(items => items.map((item, i) => {
      if (i === selected) return { ...item, beats: value, durationSeconds: duration };
      return i > selected ? { ...item, startTimeSeconds: item.startTimeSeconds + shift } : item;
    }));
    setChanged(true);
  }

  function removeNote() {
    if (notes.length <= 1) return;
    const last = notes.length - 2;
    setNotes(items => items.filter((_, i) => i !== selected));
    setLyricsStart(index => Math.min(last, selected < index ? index - 1 : index));
    setSelected(index => Math.min(last, index));
    setChanged(true);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      onSave(await saveAutoMelody(source, notes, key || null, lyricsStart));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '악보를 저장하지 못했습니다.');
    } finally { setSaving(false); }
  }

  async function reload() {
    setSaving(true);
    setError('');
    try {
      const updated = await reloadAutoMelody(source);
      setSource(updated);
      setNotes(updated.notes);
      setKey(updated.key ?? '');
      setLyricsStart(updated.lyricsStart ?? 0);
      setSelected(0);
      setChanged(false);
      onSave(updated);
    } catch { setError('저장된 악보를 불러오지 못했습니다.'); }
    finally { setSaving(false); }
  }

  return <dialog ref={dialog} className="score-edit-dialog" aria-labelledby="score-edit-title"
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <h2 id="score-edit-title">{source.title} 악보 수정</h2>
    <p>음표를 선택하거나 위아래로 끌어 음높이를 바꾸고, 길이는 박 단위로 조정하세요.</p>
    {source.videoId && /^[\w-]{11}$/.test(source.videoId) && <p><a href={`https://www.youtube.com/watch?v=${source.videoId}`} target="_blank" rel="noreferrer">분석한 녹음 확인</a></p>}
    <fieldset disabled={saving}>
      <div className="score-edit-actions">
        <label>조표 <select value={key} onChange={event => { setKey(event.target.value); setChanged(true); }}>
          <option value="">조표 없음</option>
          <optgroup label="장조">{MAJOR_KEYS.map(value => <option key={value}>{value}</option>)}</optgroup>
          <optgroup label="단조">{MINOR_KEYS.map(value => <option key={value}>{value}</option>)}</optgroup>
        </select></label>
        <button type="button" className="preview-retry" disabled={selected === lyricsStart}
          onClick={() => { setLyricsStart(selected); setChanged(true); }}>선택 음부터 가사 시작</button>
        <span>가사 시작 · {lyricsStart + 1}번 음표</span>
      </div>
      {image && <img className="score-edit-staff" src={image} alt="현재 구간 오선보" />}
      <div className="score-edit-notes">
        {notes.slice(start, start + PAGE_SIZE).map((item, i) => {
          const index = start + i;
          return <button type="button" className="preview-retry" key={index} aria-pressed={selected === index}
            aria-label={`${index + 1}번 음표 ${noteName(item.pitchMidi)}`}
            onClick={() => setSelected(index)}
            onPointerDown={event => {
              setSelected(index);
              drag.current = { index, y: event.clientY, pitch: item.pitchMidi };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={event => {
              const gesture = drag.current;
              drag.current = null;
              if (!gesture) return;
              const shift = Math.round((gesture.y - event.clientY) / 12);
              if (shift) changePitch(gesture.index, gesture.pitch + shift);
            }}
            onPointerCancel={() => { drag.current = null; }}>
            {index + 1} · {noteName(item.pitchMidi)}
          </button>;
        })}
      </div>
      <div className="score-edit-actions" role="group" aria-label="전체 음표의 옥타브">
        <button type="button" className="preview-retry" disabled={!canLowerOctave} onClick={() => transposeOctave(-1)}>전체 한 옥타브 내리기</button>
        <button type="button" className="preview-retry" disabled={!canRaiseOctave} onClick={() => transposeOctave(1)}>전체 한 옥타브 올리기</button>
      </div>
      <div className="score-edit-actions">
        <button type="button" className="preview-retry" disabled={!page} onClick={() => setSelected(start - PAGE_SIZE)}>이전</button>
        <span>{start + 1}–{Math.min(start + PAGE_SIZE, notes.length)} / {notes.length}</span>
        <button type="button" className="preview-retry" disabled={start + PAGE_SIZE >= notes.length} onClick={() => setSelected(start + PAGE_SIZE)}>다음</button>
        <button type="button" className="preview-retry" onClick={() => changePitch(selected, note.pitchMidi - 1)}>반음 내리기</button>
        <button type="button" className="preview-retry" onClick={() => changePitch(selected, note.pitchMidi + 1)}>반음 올리기</button>
        <button type="button" className="preview-retry" disabled={notes.length <= 1} onClick={removeNote}>선택 음 삭제</button>
        <label>길이 <select value={currentBeat} onChange={event => changeBeats(Number(event.target.value))}>
          {BEATS.map(value => <option key={value} value={value}>{value}박</option>)}
        </select></label>
      </div>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="score-edit-actions">
      <button type="button" className="btn btn--secondary" disabled={saving} onClick={onClose}>닫기</button>
      {error && <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => void reload()}>저장된 버전 불러오기</button>}
      <button type="button" className="btn btn--primary" disabled={!changed || saving} onClick={() => void save()}>
        {saving ? '저장 중' : '공유 악보에 수정본 저장'}
      </button>
    </div>
  </dialog>;
}
