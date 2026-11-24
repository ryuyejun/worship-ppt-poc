import logging
import os
import secrets
from contextlib import asynccontextmanager
from threading import BoundedSemaphore, Event, Thread

from fastapi import FastAPI, Header, HTTPException, Query, Response

from jobs import MelodyJobs
from sheet_images import find_score_images

logger = logging.getLogger(__name__)
worker_count = max(1, int(os.getenv("MELODY_CONCURRENCY", "2")))
analysis_slot = BoundedSemaphore(worker_count)
jobs = MelodyJobs(os.getenv("MELODY_CACHE_PATH", "melodies.sqlite3"))


def authenticate(authorization):
    token = os.getenv("AUTO_MELODY_TOKEN")
    if token and not secrets.compare_digest(authorization.encode(), f"Bearer {token}".encode()):
        raise HTTPException(401, "Unauthorized")


def analyze(title, artist="", video_id=None):
    return find_score_images(title, artist)


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


@app.post("/api/auto-melody/jobs")
def submit_melody(response: Response, title: str = Query(min_length=1, max_length=120),
                  video_id: str | None = Query(default=None, pattern=r"^[A-Za-z0-9_-]{11}$"),
                  artist: str = Query(default="", max_length=120), authorization: str = Header(default="")):
    authenticate(authorization)
    job = jobs.submit(title, artist, video_id=video_id)
    response.status_code = 200 if job["state"] == "ready" else 202
    return job


@app.get("/api/auto-melody/jobs/{job_id}")
def melody_job(job_id: str, authorization: str = Header(default="")):
    authenticate(authorization)
    return jobs.get(job_id)
