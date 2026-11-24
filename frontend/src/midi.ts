import midiPackage from '@tonejs/midi';
import type { MelodyNote } from './score';

const noteNames = ['도', '도♯', '레', '레♯', '미', '파', '파♯', '솔', '솔♯', '라', '라♯', '시'];
export type MidiNote = MelodyNote & { solfege: string; octave: number; beats: number };
export type MidiTrack = { label: string; notes: MidiNote[] };
export type MidiScore = { title: string; bpm: number; tracks: MidiTrack[] };
export type MidiMatch = MidiScore & { id: string; sourceUrl: string };

export function readMidi(bytes: Uint8Array): MidiScore {
  if (bytes.length > 1_000_000) throw new Error('1MB 이하의 MIDI 파일을 선택해 주세요.');
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'MThd') {
    throw new Error('표준 MIDI 파일(.mid 또는 .midi)을 선택해 주세요.');
  }
  const midi = new midiPackage.Midi(bytes);
  if (!midi.header.ppq) throw new Error('이 MIDI의 시간 형식을 지원하지 않습니다.');
  const tracks = midi.tracks.flatMap((track, index) => {
    if (track.instrument.percussion || !track.notes.length) return [];
    const highestAtTick = new Map<number, typeof track.notes[number]>();
    for (const note of track.notes) {
      if (note.durationTicks <= 0) continue;
      const current = highestAtTick.get(note.ticks);
      if (!current || note.midi > current.midi) highestAtTick.set(note.ticks, note);
    }
    const melody = Array.from(highestAtTick.values()).sort((a, b) => a.ticks - b.ticks);
    const notes = melody.map((note, i) => {
      const nextOnset = (melody[i + 1]?.ticks ?? Infinity) - note.ticks;
      // Common MIDI exports end notes slightly before the next beat for articulation.
      const length = nextOnset <= note.durationTicks * 1.25 ? nextOnset : note.durationTicks;
      return {
        startTimeSeconds: note.time,
        durationSeconds: note.duration,
        pitchMidi: note.midi,
        amplitude: note.velocity,
        solfege: noteNames[note.midi % 12],
        octave: Math.floor(note.midi / 12) - 1,
        beats: length / midi.header.ppq,
      };
    });
    return notes.length ? [{ label: `${index + 1}. ${track.name || track.instrument.name}`, notes }] : [];
  });
  if (!tracks.length) throw new Error('MIDI에서 멜로디 음표를 찾지 못했습니다.');
  const bpm = Math.round(midi.header.tempos[0]?.bpm ?? 120);
  return { title: midi.name, bpm: Math.min(300, Math.max(30, bpm || 120)), tracks };
}
