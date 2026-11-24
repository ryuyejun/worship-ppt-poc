"""Editable sixteenth-note MusicXML notation from timed transcription events."""
from pathlib import Path
from music21 import chord, clef, converter, key, metadata, meter, note, stream, tempo


def build_score(result):
    bpm = float(result.get('bpm') or 120)
    score = stream.Score()
    score.metadata = metadata.Metadata(title=result.get('title', 'Untitled'))
    origin = float(result.get('vocalStartSec', 0))
    groups = {}
    for event in result['notes']:
        start = max(0, round((event['startTime'] - origin) * bpm / 60 * 4) / 4)
        length = max(.25, round(event.get('beats', event['duration'] * bpm / 60) * 4) / 4)
        groups.setdefault((start, length), set()).add(int(event['pitch']))
    # Keep simultaneous pitches as chords, and split registers into staves.
    for register, test in [('Treble', lambda p: p >= 60), ('Bass', lambda p: p < 60)]:
        events = [(at, length, sorted(p for p in pitches if test(p))) for (at, length), pitches in groups.items()]
        events = [event for event in events if event[2]]
        if not events:
            continue
        part = stream.Part(id=register)
        part.insert(0, clef.TrebleClef() if register == 'Treble' else clef.BassClef())
        part.insert(0, tempo.MetronomeMark(number=bpm))
        part.insert(0, meter.TimeSignature(result.get('timeSignature') or '4/4'))
        specified = result.get('key')
        if specified:
            tonic = specified[:-1] if specified.endswith('m') else specified
            part.insert(0, key.Key(tonic.replace('b', '-'), 'minor' if specified.endswith('m') else 'major'))
        for at, length, pitches in sorted(events):
            item = note.Note(pitches[0]) if len(pitches) == 1 else chord.Chord(pitches)
            item.quarterLength = length
            part.insert(at, item)
        if not specified:
            part.insert(0, part.analyze('key'))
        # music21 creates rests, splits notes at barlines with ties and beams
        # eighth/sixteenth notes according to the active meter.
        part = part.makeNotation(inPlace=False)
        score.insert(0, part)
    return score


def export_musicxml(result, destination):
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    if result.get('sourceType') == 'sheet-omr' and result.get('originalMusicxml') and not result.get('reviewed'):
        path.write_text(result['originalMusicxml'])
    else:
        build_score(result).write('musicxml', fp=path)
    return path


def read_midi(path, title='Untitled'):
    score = converter.parse(path)
    score.quantize(quarterLengthDivisors=(4,), inPlace=True)
    bpm = next(iter(score.recurse().getElementsByClass(tempo.MetronomeMark)), None)
    bpm = float(bpm.number) if bpm and bpm.number else 120.0
    signature = next(iter(score.recurse().getElementsByClass(meter.TimeSignature)), None)
    events = []
    for item in score.flatten().notes:
        for pitch in item.pitches:
            events.append(dict(pitch=pitch.midi, startTime=float(item.offset) * 60 / bpm,
                               duration=float(item.quarterLength) * 60 / bpm,
                               beats=float(item.quarterLength), amplitude=.8))
    if not events:
        raise ValueError('MIDI has no notes')
    found_key = score.analyze('key')
    return dict(title=title, bpm=bpm, key=found_key.tonic.name.replace('-', 'b') + ('m' if found_key.mode == 'minor' else ''),
                timeSignature=signature.ratioString if signature else '4/4', meterEstimated=not bool(signature),
                notes=sorted(events, key=lambda x: x['startTime']), vocalStartSec=0,
                vocalEndSec=max(e['startTime'] + e['duration'] for e in events))
