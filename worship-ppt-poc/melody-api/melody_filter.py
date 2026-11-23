from math import sqrt

MAJOR = (0, 2, 4, 5, 7, 9, 11)
MINOR = (0, 2, 3, 5, 7, 8, 10)
MAJOR_NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
MINOR_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B")
PROFILES = (
    (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88),
    (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17),
)


def detect_vocal_bounds(events, *, min_hz=150.0, max_hz=1000.0, min_run_seconds=0.3, merge_gap_seconds=0.12):
    """Find the first/last sustained voice-range pitch run from Basic Pitch events.

    Events use Basic Pitch's ``(start, end, midi_pitch, confidence, ...)`` shape.
    Adjacent pitch changes remain part of one vocal phrase when the gap is short.
    """
    pitches = []
    for event in events:
        try:
            start, end, midi_pitch, strength = map(float, event[:4])
        except (TypeError, ValueError, IndexError):
            continue
        frequency = 440.0 * 2 ** ((midi_pitch - 69.0) / 12.0)
        if (start < 0 or end <= start or not min_hz <= frequency <= max_hz
                or strength < 0.25):
            continue
        pitches.append((start, end))
    pitches.sort()
    if not pitches:
        return None

    runs = []
    run_start, run_end = pitches[0]
    for start, end in pitches[1:]:
        if start <= run_end + merge_gap_seconds:
            run_end = max(run_end, end)
        else:
            runs.append((run_start, run_end))
            run_start, run_end = start, end
    runs.append((run_start, run_end))
    sustained = [(start, end) for start, end in runs if end - start >= min_run_seconds]
    if not sustained:
        return None
    return round(sustained[0][0], 3), round(sustained[-1][1], 3)


def filter_notes_to_vocal_bounds(
    notes, vocal_start_sec, vocal_end_sec, *, min_note_seconds=0.15,
    min_hz=150.0, max_hz=1000.0,
):
    """Clip score notes to the detected singing window and discard short noise."""
    filtered = []
    for source in sorted(notes, key=lambda item: item["startTime"]):
        frequency = 440.0 * 2 ** ((float(source["pitch"]) - 69.0) / 12.0)
        if not min_hz <= frequency <= max_hz:
            continue
        start = max(float(source["startTime"]), vocal_start_sec)
        end = min(float(source["startTime"]) + float(source["duration"]), vocal_end_sec)
        if end - start < min_note_seconds:
            continue
        note = {**source, "startTime": round(start, 4), "duration": round(end - start, 4)}
        previous = filtered[-1] if filtered else None
        if previous and previous["pitch"] == note["pitch"] and start - (previous["startTime"] + previous["duration"]) <= 0.04:
            previous["duration"] = round(end - previous["startTime"], 4)
            previous["amplitude"] = max(previous["amplitude"], note["amplitude"])
        else:
            filtered.append(note)
    return filtered


def normalize(values):
    mean = sum(values) / len(values)
    centered = [value - mean for value in values]
    norm = sqrt(sum(value * value for value in centered)) or 1
    return [value / norm for value in centered]


def candidates_matching_voice(path, events):
    import librosa
    import numpy as np

    samples, rate = librosa.load(path, sr=11025)
    hop = 256
    frame = 1024
    frequency = librosa.yin(samples, fmin=85, fmax=1050, sr=rate, frame_length=frame, hop_length=hop)
    pitch_track = librosa.hz_to_midi(frequency)
    rms = librosa.feature.rms(y=samples, frame_length=frame, hop_length=hop)[0]
    audible = rms >= max(0.001, np.percentile(rms, 90) * 0.07)
    for start, end, pitch, strength, *_ in events:
        first = max(0, int(np.ceil(start * rate / hop)))
        last = min(len(pitch_track), int(np.ceil(end * rate / hop)))
        if last <= first:
            continue
        agreement = np.mean(audible[first:last] & (np.abs(pitch_track[first:last] - pitch) <= 0.85))
        if agreement >= 0.35:
            yield start, end, pitch, float(strength) * (0.55 + 0.45 * agreement)


def extract_line(events):
    candidates = [(float(start), float(end), int(pitch), float(strength))
                  for start, end, pitch, strength, *_ in events
                  if end - start >= 0.095 and 45 <= pitch <= 88 and strength >= 0.25]
    if not candidates:
        return []
    timeline = {}
    for index, (start, end, _, _) in enumerate(candidates):
        timeline.setdefault(start, ([], []))[0].append(index)
        timeline.setdefault(end, ([], []))[1].append(index)
    times = sorted(timeline)
    active = set()
    scores = {None: 0.0}
    history = []
    # Search the most plausible path across every onset and release, including rests.
    for time, end in zip(times, times[1:]):
        starts, stops = timeline[time]
        active.difference_update(stops)
        active.update(starts)
        choices = sorted(active, key=lambda i: (-candidates[i][3], i))[:8]
        next_scores = {}
        parents = {}
        for current in [None, *choices]:
            def transition(previous):
                if previous == current:
                    return 0
                if previous is None or current is None:
                    return 0.25
                jump = abs(candidates[previous][2] - candidates[current][2])
                return 0.45 + min(jump, 18) * 0.09

            best = max(scores, key=lambda previous: scores[previous] - transition(previous))
            emission = 0 if current is None else (candidates[current][3] - 0.24) * (end - time) * 32
            next_scores[current] = scores[best] - transition(best) + emission
            parents[current] = best
        scores = next_scores
        history.append(parents)
    current = max(scores, key=scores.get)
    path = []
    for parents in reversed(history):
        path.append(current)
        current = parents[current]

    spans = []
    for i, choice in enumerate(reversed(path)):
        if choice is None:
            continue
        if spans and spans[-1][0] == choice and spans[-1][2] == times[i]:
            spans[-1] = (choice, spans[-1][1], times[i + 1])
        else:
            spans.append((choice, times[i], times[i + 1]))
    return [{"pitch": candidates[i][2], "startTime": round(start, 4),
             "duration": round(end - start, 4), "amplitude": round(candidates[i][3], 4)}
            for i, start, end in spans if end - start >= 0.085]


def quantize_key(notes, accompaniment=None):
    weights = [0.0] * 12
    for note in notes:
        weights[note["pitch"] % 12] += min(note["duration"], 2) * note["amplitude"]
    if len(notes) < 12 or sum(weight > 0 for weight in weights) < 5:
        return None
    histogram = normalize(weights)
    if accompaniment is not None:
        backing = normalize(accompaniment)
        histogram = [0.55 * voice + 0.45 * band for voice, band in zip(histogram, backing)]
    ranks = sorted(
        ((sum(histogram[(root + step) % 12] * value for step, value in enumerate(normalize(profile))),
          mode, root) for mode, profile in enumerate(PROFILES) for root in range(12)),
        reverse=True,
    )
    confidence, mode, root = ranks[0]
    if confidence < 0.60:
        return None
    scale = {(root + step) % 12 for step in (MINOR if mode else MAJOR)}
    # Relative major/minor share a scale. Preserve deliberate chromatic notes and
    # only correct short, weak candidates with a close in-scale neighbor.
    ambiguous = any(confidence - score < 0.045 and
                    {(candidate_root + step) % 12 for step in (MINOR if candidate_mode else MAJOR)} != scale
                    for score, candidate_mode, candidate_root in ranks[1:])
    if ambiguous:
        return None
    for index, note in enumerate(notes):
        pitch = note["pitch"]
        if pitch % 12 in scale or note["duration"] > 0.22 or note["amplitude"] >= 0.55:
            continue
        nearby = [candidate for candidate in (pitch - 1, pitch + 1) if candidate % 12 in scale]
        neighbors = [notes[i]["pitch"] for i in (index - 1, index + 1) if 0 <= i < len(notes)]
        if nearby:
            note["pitch"] = min(nearby, key=lambda candidate: sum(abs(candidate - other) for other in neighbors))
    return (MINOR_NAMES[root] + "m") if mode else MAJOR_NAMES[root]


def fit_treble_register(notes):
    """Keep the melody's intervals while choosing a practical treble-clef octave."""
    pitches = [note["pitch"] for note in notes]
    for index in range(1, len(notes) - 1):
        previous, note, following = notes[index - 1:index + 2]
        before, middle, after = pitches[index - 1:index + 2]
        if (note["duration"] > 0.22 or note["amplitude"] >= 0.55
                or note["startTime"] - previous["startTime"] - previous["duration"] > 0.35
                or following["startTime"] - note["startTime"] - note["duration"] > 0.35
                or abs(before - after) > 4
                or min(abs(middle - before), abs(middle - after)) < 10):
            continue
        for offset in (-12, 12):
            corrected = middle + offset
            if 0 <= corrected <= 127 and max(abs(corrected - before), abs(corrected - after)) <= 3:
                note["pitch"] = corrected
                break

    weighted = sorted((note["pitch"], min(note["duration"], 0.6)) for note in notes)
    midpoint = sum(weight for _, weight in weighted) / 2
    for center, weight in weighted:
        midpoint -= weight
        if midpoint <= 0:
            break
    if not weighted:
        return 0
    lowest, highest = weighted[0][0], weighted[-1][0]
    possible = (offset for offset in (0, 12, -12, 24, -24, 36, -36)
                if lowest + offset >= 0 and highest + offset <= 127)
    offset = min(possible, key=lambda amount: (abs(center + amount - 67), abs(amount)))
    for note in notes:
        note["pitch"] += offset
    return offset
