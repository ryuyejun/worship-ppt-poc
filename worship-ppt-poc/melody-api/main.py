import json
import logging
import os
from pathlib import Path
import secrets
import signal
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import asynccontextmanager
from threading import BoundedSemaphore, Event, Thread
import unicodedata

from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from jobs import MelodyJobs, ScoreRevision

logger = logging.getLogger(__name__)
cache_path = Path(os.getenv("MELODY_CACHE_PATH", "melodies.sqlite3"))
worker_count = max(1, int(os.getenv("MELODY_CONCURRENCY", "2")))
analysis_slot = BoundedSemaphore(worker_count)
jobs = MelodyJobs(cache_path)


@asynccontextmanager
async def lifespan(_app):
    jobs.setup()
    stop = Event()
    for _ in range(worker_count):
        Thread(target=jobs.run, args=(stop, analyze, analysis_slot), daemon=True).start()
    try:
        yield
    finally:
        stop.set()


app = FastAPI(lifespan=lifespan)


def authenticate(authorization):
    token = os.getenv("AUTO_MELODY_TOKEN")
    if token and not secrets.compare_digest(authorization.encode(), f"Bearer {token}".encode()):
        raise HTTPException(401, "Unauthorized")



def cached_result(key, result=None):
    with sqlite3.connect(cache_path) as db:
        db.execute("CREATE TABLE IF NOT EXISTS melodies (title TEXT PRIMARY KEY, result TEXT NOT NULL)")
        if result is not None:
            db.execute("INSERT OR REPLACE INTO melodies VALUES (?, ?)", (key, json.dumps(result)))
            return result
        row = db.execute("SELECT result FROM melodies WHERE title = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None


def analyze(title, artist="", audio=None):
    with tempfile.TemporaryDirectory(prefix="yebit-melody-") as directory:
        workdir = Path(directory)
        script = Path(__file__).with_name("transcribe.py").resolve()
        if audio:
            (workdir / "uploaded.audio").write_bytes(audio)
        with subprocess.Popen(
            [sys.executable, str(script), title, directory, artist], start_new_session=True,
            stdout=subprocess.DEVNULL,
            env={**os.environ, "OMP_NUM_THREADS": os.getenv("MELODY_THREADS", "2"),
                 "OPENBLAS_NUM_THREADS": os.getenv("MELODY_THREADS", "2"),
                 "MKL_NUM_THREADS": os.getenv("MELODY_THREADS", "2")},
        ) as process:
            try:
                return_code = process.wait(timeout=180)
            except subprocess.TimeoutExpired:
                # Stop yt-dlp, ffmpeg and Demucs as well before removing their files.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                raise
        if return_code == 3:
            return None
        if return_code:
            raise RuntimeError(f"Transcriber exited with code {return_code}")
        return json.loads((workdir / "result.json").read_text())


@app.get("/api/auto-melody")
def auto_melody(
    title: str = Query(min_length=1, max_length=120),
    authorization: str = Header(default=""),
):
    authenticate(authorization)
    title = " ".join(unicodedata.normalize("NFC", title).split())
    if not title:
        raise HTTPException(400, "A song title is required")
    key = title.casefold()
    try:
        cached = cached_result(key)
        if cached is not None:
            return cached
        if not analysis_slot.acquire(blocking=False):
            raise HTTPException(503, "Melody analysis is busy", headers={"Retry-After": "5"})
        try:
            result = analyze(title)
            if not result:
                raise HTTPException(404, "No matching melody found")
            return cached_result(key, result)
        finally:
            analysis_slot.release()
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Melody analysis timed out") from None
    except (OSError, ValueError, RuntimeError, sqlite3.Error):
        logger.exception("Melody analysis failed")
        raise HTTPException(502, "Melody analysis failed") from None

@app.post("/api/auto-melody/jobs")
def submit_melody(response: Response, title: str = Query(min_length=1, max_length=120),
                  artist: str = Query(default="", max_length=120), authorization: str = Header(default="")):
    authenticate(authorization)
    job = jobs.submit(title, artist)
    response.status_code = 200 if job["state"] == "ready" else 202
    return job


@app.post("/api/auto-melody/jobs/upload")
async def submit_audio(request: Request, response: Response, title: str = Query(min_length=1, max_length=120),
                       artist: str = Query(default="", max_length=120), authorization: str = Header(default="")):
    authenticate(authorization)
    audio = bytearray()
    async for chunk in request.stream():
        if len(audio) + len(chunk) > 20 * 1024 * 1024:
            raise HTTPException(413, "Audio must be 20 MiB or smaller")
        audio.extend(chunk)
    if not audio:
        raise HTTPException(400, "Audio is required")
    job = await run_in_threadpool(jobs.submit, title, artist, bytes(audio))
    response.status_code = 200 if job["state"] == "ready" else 202
    return job


@app.get("/api/auto-melody/jobs/{job_id}")
def melody_job(job_id: str, authorization: str = Header(default="")):
    authenticate(authorization)
    return jobs.get(job_id)


@app.put("/api/auto-melody/jobs/{job_id}")
def revise_melody(job_id: str, edit: ScoreRevision, authorization: str = Header(default="")):
    authenticate(authorization)
    return jobs.revise(job_id, edit)
