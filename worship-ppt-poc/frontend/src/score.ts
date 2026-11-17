import modelUrl from '@spotify/basic-pitch/model/model.json?url';
import weightsUrl from '@spotify/basic-pitch/model/group1-shard1of1.bin?url';

export type MelodyNote = { startTimeSeconds: number; durationSeconds: number; pitchMidi: number; amplitude: number; beats?: number };
type ScoreRow = { lyrics: string; notes: MelodyNote[] };
export type ScoreSlide = { title: string; rows: { lyrics: string; staff: string }[] };

const sampleRate = 22050;
const maxSeconds = 360;
let transcriber: Promise<import('@spotify/basic-pitch').BasicPitch> | undefined;

function getTranscriber() {
  transcriber ??= Promise.all([import('@spotify/basic-pitch'), import('@tensorflow/tfjs')]).then(
    async ([{ BasicPitch }, tf]) => {
      const model = await tf.loadGraphModel(modelUrl, { weightUrlConverter: async () => weightsUrl });
      return new BasicPitch(Promise.resolve(model));
    },
  ).catch(error => { transcriber = undefined; throw error; });
  return transcriber;
}

async function decodeAudio(file: File) {
  if (file.size > 60_000_000) throw new Error('60MB 이하의 음원 파일을 선택해 주세요.');
  const decoder = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decoder.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('음원을 읽지 못했습니다. WAV 또는 MP3 파일로 다시 시도해 주세요.');
  } finally {
    await decoder.close();
  }
  if (decoded.duration > maxSeconds) throw new Error('시험판은 6분 이하의 음원을 지원합니다.');
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

export const sampleLyrics = '[00:00.00] 반짝 반짝 작은 별\n[00:04.00] 아름답게 비치네';

function sampleAudio() {
  const pitches = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];
  const samples = new Float32Array(sampleRate * 8);
  let start = 0;
  pitches.forEach((pitch, index) => {
    const duration = index % 7 === 6 ? 1 : 0.5;
    const count = Math.round((duration - 0.075) * sampleRate);
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    for (let i = 0; i < count; i++) {
      const wave = 2 * Math.PI * frequency * i / sampleRate;
      const envelope = Math.min(1, i / 220, (count - i) / 440);
      samples[start + i] = (Math.sin(wave)) * envelope * 0.5;
    }
    start += duration * sampleRate;
  });
  return samples;
}

export async function analyzeMelody(file: File | null, progress: (fraction: number) => void) {
  const samples = file ? await decodeAudio(file) : sampleAudio();
  const [{ noteFramesToTime, outputToNotesPoly }, model, tf] = await Promise.all([
    import('@spotify/basic-pitch'), getTranscriber(), import('@tensorflow/tfjs'),
  ]);
  const detected: MelodyNote[] = [];
  const chunkSize = 20 * sampleRate;
  const overlap = sampleRate;
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const start = Math.max(0, offset - overlap);
    const end = Math.min(samples.length, offset + chunkSize + overlap);
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const engine = tf.engine();
    engine.startScope();
    try {
      await model.evaluateModel(samples.subarray(start, end), (f, o) => {
        frames.push(...f);
        onsets.push(...o);
      }, fraction => progress(Math.min(1, (offset + fraction * chunkSize) / samples.length)));
    } finally {
      engine.endScope();
    }
    for (const note of noteFramesToTime(outputToNotesPoly(frames, onsets, 0.45, 0.35, 8))) {
      const time = Math.max(0, note.startTimeSeconds + start / sampleRate);
      if (time >= offset / sampleRate && time < (offset + chunkSize) / sampleRate) {
        detected.push({ ...note, startTimeSeconds: time });
      }
    }
  }
  const melody: MelodyNote[] = [];
  for (const note of detected.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)) {
    const last = melody.at(-1);
    if (last && note.startTimeSeconds - last.startTimeSeconds < 0.075) {
      if (note.amplitude > last.amplitude) melody[melody.length - 1] = note;
    } else {
      melody.push(note);
    }
  }
  if (!melody.length) throw new Error('감지된 음표가 없습니다. 보컬이나 악기 소리가 더 또렷한 파일을 선택해 주세요.');
  return melody;
}

function scoreRows(text: string, notes: MelodyNote[]): ScoreRow[] {
  const blocks: string[][] = [];
  let block: string[] = [];
  const flush = () => { if (block.length) blocks.push(block); block = []; };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^\[[^\]]+\]$/.test(line)) flush();
    else block.push(line);
  }
  flush();
  const lines = blocks.flat();
  const timed = lines.map(line => {
    const match = line.match(/^\[(\d+):([0-5]\d(?:\.\d{1,3})?)\]\s*(.+)$/);
    return match ? { time: Number(match[1]) * 60 + Number(match[2]), lyrics: match[3] } : null;
  });
  if (timed.some(Boolean)) {
    if (!timed.every(entry => entry !== null)) throw new Error('시간을 쓰려면 모든 가사 줄에 [00:00.00] 형식으로 입력해 주세요.');
    if (timed.some((entry, i) => i > 0 && entry.time <= timed[i - 1].time)) {
      throw new Error('가사 시작 시간은 앞줄부터 순서대로 입력해 주세요.');
    }
    // The model can place an onset a few frames before its lyric cue.
    const leadInSeconds = 0.05;
    return timed.map((entry, i) => {
      const start = entry.time - leadInSeconds;
      const end = (timed[i + 1]?.time ?? Infinity) - leadInSeconds;
      return { lyrics: entry.lyrics, notes: notes.filter(note => note.startTimeSeconds >= start && note.startTimeSeconds < end) };
    });
  }
  if (!lines.length) return [{ lyrics: '', notes }];
  const alignNotes = (lyrics: string[], melody: MelodyNote[]): ScoreRow[] => {
    const weights = lyrics.map(line => Math.max(1, [...line.replace(/\s/g, '')].length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let consumed = 0;
    let previous = 0;
    return lyrics.map((line, i) => {
      consumed += weights[i];
      const next = Math.round(melody.length * consumed / total);
      const row = { lyrics: line, notes: melody.slice(previous, next) };
      previous = next;
      return row;
    });
  };

  // Hymn MIDI files often contain only the first verse, while the lyrics include
  // several stanzas that use that same tune. Repeat the melody for matching stanzas
  // instead of spreading one short tune across every verse.
  if (blocks.length > 1 && blocks.every(candidate => candidate.length === blocks[0].length)) {
    const shapes = blocks.map(candidate => {
      const weights = candidate.map(line => Math.max(1, [...line.replace(/\s/g, '')].length));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      return weights.map(weight => weight / total);
    });
    const similarStanzas = shapes.every(shape => shape.every((weight, i) => Math.abs(weight - shapes[0][i]) < 0.2));
    const tuneDuration = Math.max(...notes.map(note => note.startTimeSeconds + note.durationSeconds));
    if (similarStanzas && tuneDuration <= 45 && notes.length >= blocks[0].length * 2) {
      return blocks.flatMap(stanza => alignNotes(stanza, notes));
    }
  }

  return alignNotes(lines, notes);
}

function drawStaff(notes: MelodyNote[], bpm: number, vf: typeof import('vexflow/bravura'), color: string, key?: string) {
  const canvas = document.createElement('canvas');
  const width = 1000;
  const height = 160;
  const renderer = new vf.Renderer(canvas, vf.Renderer.Backends.CANVAS);
  renderer.resize(width, height);
  const context = renderer.getContext();
  context.setStrokeStyle(color);
  context.setFillStyle(color);
  const stave = new vf.Stave(12, 36, width - 24).addClef('treble').setContext(context);
  const music = new vf.Music();
  const scale = key ? music.createScaleMap(key.toLowerCase()) : {};
  if (key) stave.addKeySignature(key);
  const sharpNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const flatNames = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
  const names = Object.values(scale).some(name => name.endsWith('b') && name.length > 1) ? flatNames : sharpNames;
  const accidentals = new Map<string, string>();
  const durations = [[0.25, '16', false], [0.5, '8', false], [0.75, '8', true], [1, 'q', false], [1.5, 'q', true], [2, 'h', false], [3, 'h', true], [4, 'w', false]] as const;
  const staveNotes = notes.map((note, i) => {
    const pitchClass = note.pitchMidi % 12;
    const pitch = (Object.values(scale).find(name => music.getNoteValue(name.replace(/n$/, '')) === pitchClass) ?? names[pitchClass]).replace(/n$/, '');
    const letter = pitch[0];
    const accidental = pitch.slice(1) || 'n';
    const offset = accidental === 'n' ? 0 : accidental[0] === '#' ? accidental.length : -accidental.length;
    const octave = (note.pitchMidi - music.getNoteValue(letter) - offset) / 12 - 1;
    const position = `${letter}/${octave}`;
    const gap = (notes[i + 1]?.startTimeSeconds ?? Infinity) - note.startTimeSeconds;
    const beats = note.beats ?? Math.min(gap, note.durationSeconds) * bpm / 60;
    const [, duration, dotted] = durations.reduce((best, option) =>
      Math.abs(option[0] - beats) < Math.abs(best[0] - beats) ? option : best);
    const staveNote = new vf.StaveNote({ keys: [`${pitch}/${octave}`], duration, autoStem: true });
    if (dotted) vf.Dot.buildAndAttach([staveNote], { all: true });
    staveNote.setStemStyle({ strokeStyle: color, fillStyle: color });
    staveNote.setLedgerLineStyle({ strokeStyle: color });
    if (accidental !== (accidentals.get(position) ?? scale[letter]?.slice(1) ?? 'n')) {
      staveNote.addModifier(new vf.Accidental(accidental), 0);
    }
    accidentals.set(position, accidental);
    return staveNote;
  });
  stave.draw();
  vf.Formatter.FormatAndDraw(context, stave, staveNotes, { autoBeam: true });
  return canvas.toDataURL('image/png');
}

// Allocate notes to the lines already chosen by the PPT layout. Favor phrase
// breaks near the expected syllable boundary, while leaving notes for later lines.
export function alignMelodyNotes(lines: string[], notes: MelodyNote[], bpm: number): MelodyNote[][] {
  if (!lines.length || notes.length < lines.length) return lines.map(() => []);
  const weights = lines.map(line => Math.max(1, (line.normalize('NFC').match(/[\p{L}\p{N}]/gu) ?? []).length));
  let remainingWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let start = 0;
  return weights.map((weight, index) => {
    const linesAfter = weights.length - index - 1;
    if (!linesAfter) return notes.slice(start);
    const expected = (notes.length - start) * weight / remainingWeight;
    const target = start + expected;
    const radius = Math.max(1, Math.min(8, Math.round(expected * 0.3)));
    let end = Math.min(notes.length - linesAfter, Math.max(start + 1, Math.round(target)));
    let best = -Infinity;
    const first = Math.max(start + 1, end - radius);
    const last = Math.min(notes.length - linesAfter, end + radius);
    for (let boundary = first; boundary <= last; boundary++) {
      const previous = notes[boundary - 1];
      const restBeats = Math.max(0, notes[boundary].startTimeSeconds - previous.startTimeSeconds - previous.durationSeconds) * bpm / 60;
      const score = Math.min(2, restBeats) - Math.abs(target - boundary) / radius;
      if (score > best) { best = score; end = boundary; }
    }
    const row = notes.slice(start, end);
    start = end;
    remainingWeight -= weight;
    return row;
  });
}

export async function renderAutoScoreRows(
  rows: { lyrics: string; notes: MelodyNote[] }[], bpm: number, color: string, key?: string,
): Promise<ScoreSlide['rows']> {
  if (!rows.some(row => row.notes.length)) return [];
  const vf = await import('vexflow/bravura');
  await vf.VexFlow.loadFonts('Bravura', 'Academico');
  return rows.map(row => ({
    lyrics: row.lyrics,
    staff: row.notes.length ? drawStaff(row.notes, bpm, vf, color, key) : '',
  }));
}

export async function makeScoreSlides(title: string, lyrics: string, notes: MelodyNote[], bpm: number, staffColor = '#000000') {
  const vf = await import('vexflow/bravura');
  await vf.VexFlow.loadFonts('Bravura', 'Academico');
  const rows = scoreRows(lyrics, notes).flatMap(row => {
    const count = Math.max(1, Math.ceil(row.notes.length / 16), Math.ceil([...row.lyrics].length / 24));
    const characters = [...row.lyrics];
    const textChunkSize = Math.ceil(characters.length / count);
    const noteChunkSize = Math.ceil(row.notes.length / count);
    return Array.from({ length: count }, (_, i) => ({
      lyrics: characters.slice(i * textChunkSize, (i + 1) * textChunkSize).join('').trim(),
      notes: row.notes.slice(i * noteChunkSize, (i + 1) * noteChunkSize),
    }));
  });
  const rendered = rows.map(row => ({
    lyrics: row.lyrics,
    staff: row.notes.length ? drawStaff(row.notes, bpm, vf, staffColor) : '',
  }));
  const slides: ScoreSlide[] = [];
  for (let i = 0; i < rendered.length; i += 2) slides.push({ title, rows: rendered.slice(i, i + 2) });
  return slides;
}

export async function downloadScore(slides: ScoreSlide[]) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const ppt = new PptxGenJS();
  ppt.layout = 'LAYOUT_WIDE';
  for (const item of slides) {
    const slide = ppt.addSlide();
    slide.background = { color: 'F9F4E8' };
    slide.addText(item.title, { x: 0.55, y: 0.44, w: 12.23, h: 0.55, margin: 0, color: '995426', fontFace: '맑은 고딕', bold: true, fontSize: 27, fit: 'shrink' });
    item.rows.forEach((row, i) => {
      const x = i === 0 ? 0.55 : 3.23;
      const y = i === 0 ? 1.32 : 4.25;
      if (row.staff) slide.addImage({ data: row.staff, x, y, w: 9.55, h: 1.528 });
      slide.addText(row.lyrics, { x, y: y + 1.55, w: 9.55, h: 0.85, margin: 0, align: 'center', color: '1B1815', fontFace: '맑은 고딕', bold: true, fontSize: 35, fit: 'shrink' });
    });
  }
  await ppt.writeFile({ fileName: `${slides[0].title.replace(/[\\/:*?"<>|]/g, '_') || '찬양 악보'}.pptx` });
}
