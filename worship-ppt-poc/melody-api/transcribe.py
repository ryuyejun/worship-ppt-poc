import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unicodedata

from melody_filter import candidates_matching_voice, extract_line, fit_treble_register, quantize_key


YTDLP = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
         "--socket-timeout", "10", "--retries", "1", "--no-warnings"]
if node := shutil.which("node"):
    YTDLP.extend(["--js-runtimes", f"node:{node}"])


def title_key(title):
    return "".join(char for char in unicodedata.normalize("NFC", title).casefold() if char.isalnum())


def find_audio(title, directory, artist=""):
    queries = [(f"{title} 찬양", True), (f"{title} 피아노 멜로디", False)]
    if artist:
        queries.insert(0, (f"{title} {artist} 찬양", True))
    for query, has_vocals in queries:
        result = subprocess.run(
            [*YTDLP, "--flat-playlist", "--skip-download", "--dump-json", "--", f"ytsearch5:{query}"],
            stdout=subprocess.PIPE, text=True, check=False,
        )
        for line in result.stdout.splitlines():
            video = json.loads(line)
            video_id = video.get("id") or ""
            duration = video.get("duration") or 0
            video_title = video.get("title") or ""
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) or not 30 <= duration <= 480:
                continue
            if not title_key(title) or title_key(title) not in title_key(video_title) or re.search(
                r"모음|모아듣기|메들리|medley|playlist|반복재생|노래방|\bMR\b", video_title, re.I
            ):
                continue
            if has_vocals and re.search(r"반주|instrumental|karaoke|피아노", video_title, re.I):
                continue
            if not has_vocals and not re.search(r"피아노|멜로디|piano|melody", video_title, re.I):
                continue
            download = subprocess.run([
                *YTDLP, "--max-filesize", "60M", "--match-filter", "duration <= 480 & !is_live",
                "-f", "bestaudio", "-x", "--audio-format", "wav",
                "-o", str(directory / "%(id)s.%(ext)s"), "--",
                f"https://www.youtube.com/watch?v={video_id}",
            ], check=False)
            wav = directory / f"{video_id}.wav"
            if download.returncode == 0 and wav.is_file():
                return wav, has_vocals, video_id
    return None


def isolate_melody(wav, has_vocals, directory):
    if has_vocals:
        subprocess.run([
            sys.executable, "-m", "demucs", "--two-stems", "vocals", "-n", "htdemucs",
            "-d", "cpu", "-j", "1", "-o", str(directory), str(wav),
        ], check=True)
        wav = directory / "htdemucs" / wav.stem / "vocals.wav"
    filtered = directory / "melody.wav"
    subprocess.run([
        "ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(wav), "-ac", "1",
        "-af", "highpass=f=80,lowpass=f=4500", str(filtered),
    ], check=True)
    return filtered


def transcribe(title, directory, artist=""):
    import librosa
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import predict

    uploaded = directory / "uploaded.audio"
    if uploaded.is_file():
        wav = directory / "uploaded.wav"
        subprocess.run([
            "ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(uploaded),
            "-vn", "-t", "481", "-ar", "44100", "-ac", "2", str(wav),
        ], check=True)
        if librosa.get_duration(path=wav) > 480:
            return None
        has_vocals, video_id = True, None
    else:
        source = find_audio(title, directory, artist)
        if source is None:
            return None
        wav, has_vocals, video_id = source
    melody = isolate_melody(wav, has_vocals, directory)

    samples, rate = librosa.load(wav, sr=11025, duration=120)
    tempo, _ = librosa.beat.beat_track(y=samples, sr=rate)
    bpm = float(tempo.reshape(-1)[0]) if hasattr(tempo, "reshape") else float(tempo)
    if not 40 <= bpm <= 240:
        bpm = 120

    _, _, events = predict(melody, build_icassp_2022_model_path(FilenameSuffix.onnx), minimum_frequency=85, maximum_frequency=1050)
    notes = extract_line(candidates_matching_voice(melody, events) if has_vocals else events)
    chroma = librosa.feature.chroma_stft(y=samples, sr=rate, n_fft=4096, hop_length=1024)
    key = quantize_key(notes, chroma.mean(axis=1)) if notes else None
    if not notes:
        return None
    shift = fit_treble_register(notes)
    return {"title": title, "videoId": video_id, "bpm": round(bpm, 2), "key": key, "notes": notes,
            "notationTransposeSemitones": shift}


if __name__ == "__main__":
    directory = Path(sys.argv[2]).resolve()
    result = transcribe(sys.argv[1], directory, sys.argv[3] if len(sys.argv) > 3 else "")
    if result is None:
        sys.exit(3)
    (directory / "result.json").write_text(json.dumps(result, ensure_ascii=False))
