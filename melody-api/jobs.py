import hashlib
import json
import logging
import re
import sqlite3
import time
import unicodedata
from contextlib import contextmanager
from uuid import uuid4

from fastapi import HTTPException

from sheet_images import SHEET_CACHE_VERSION

logger = logging.getLogger(__name__)


def normalize(text):
    return " ".join(unicodedata.normalize("NFC", text).split())


class MelodyJobs:
    def __init__(self, path):
        self.path = path

    @contextmanager
    def transaction(self, write=False):
        db = sqlite3.connect(self.path, timeout=3)
        db.row_factory = sqlite3.Row
        try:
            with db:
                if write:
                    db.execute("BEGIN IMMEDIATE")
                yield db
        finally:
            db.close()

    def setup(self):
        with self.transaction() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS melody_jobs (
                    id TEXT PRIMARY KEY,
                    song_key TEXT UNIQUE NOT NULL,
                    title TEXT NOT NULL,
                    artist TEXT NOT NULL,
                    video_id TEXT,
                    state TEXT NOT NULL DEFAULT 'queued',
                    updated REAL NOT NULL,
                    lease TEXT,
                    error TEXT,
                    result TEXT
                );
                CREATE INDEX IF NOT EXISTS melody_job_queue ON melody_jobs(state, updated);
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(melody_jobs)")}
            if "video_id" not in columns:
                db.execute("ALTER TABLE melody_jobs ADD COLUMN video_id TEXT")
            if "result" not in columns:
                db.execute("ALTER TABLE melody_jobs ADD COLUMN result TEXT")
            legacy_revisions = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='melody_revisions'"
            ).fetchone()
            if legacy_revisions:
                db.execute("""
                    UPDATE melody_jobs SET result=(
                        SELECT result FROM melody_revisions
                        WHERE melody_revisions.job_id=melody_jobs.id
                        ORDER BY revision DESC LIMIT 1
                    ) WHERE result IS NULL
                """)
                db.execute("DROP TABLE melody_revisions")

    def submit(self, title, artist, video_id=None):
        title, artist = normalize(title), normalize(artist)
        if not title:
            raise HTTPException(400, "A song title is required")
        if video_id is not None and not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise HTTPException(422, "A valid YouTube video ID is required")
        identity = [SHEET_CACHE_VERSION, title.casefold(), artist.casefold(), video_id]
        key = hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()
        with self.transaction() as db:
            current = db.execute("SELECT id, state FROM melody_jobs WHERE song_key=?", (key,)).fetchone()
        if current and current["state"] != "failed":
            return self.get(current["id"])
        with self.transaction(write=True) as db:
            db.execute("""
                INSERT INTO melody_jobs (id, song_key, title, artist, video_id, updated) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(song_key) DO UPDATE SET state='queued', updated=excluded.updated, error=NULL, lease=NULL, result=NULL
                WHERE melody_jobs.state='failed'
            """, (uuid4().hex, key, title, artist, video_id, time.time()))
            job_id = db.execute("SELECT id FROM melody_jobs WHERE song_key=?", (key,)).fetchone()["id"]
        return self.get(job_id)

    def get(self, job_id):
        with self.transaction() as db:
            row = db.execute("""
                SELECT id, state, error, result
                FROM melody_jobs WHERE id=?
            """, (job_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Melody job not found")
        outcome = {"jobId": row["id"], "state": row["state"]}
        if row["result"]:
            outcome["score"] = json.loads(row["result"])
        if row["error"]:
            outcome["error"] = row["error"]
        return outcome

    def claim(self):
        with self.transaction(write=True) as db:
            now = time.time()
            return db.execute("""
                UPDATE melody_jobs SET state='running', updated=?, lease=?
                WHERE id=(SELECT id FROM melody_jobs
                          WHERE state='queued' OR (state='running' AND updated < ?)
                          ORDER BY updated LIMIT 1)
                RETURNING id, title, artist, video_id, lease
            """, (now, uuid4().hex, now - 240)).fetchone()

    def run(self, stop, analyze, slots):
        while not stop.is_set():
            try:
                with slots:
                    if stop.is_set():
                        break
                    job = self.claim()
                    if job:
                        self.process(job, analyze)
                        continue
            except sqlite3.Error:
                logger.exception("Melody worker database operation failed")
            stop.wait(0.35)

    def process(self, job, analyze):
        error = None
        result = None
        try:
            result = analyze(job["title"], job["artist"], job["video_id"])
            if not result:
                error = "이 곡의 악보 이미지를 찾지 못했습니다."
        except ValueError as exc:
            error = str(exc)
        except Exception:
            logger.exception("Score image search failed for %s", job["id"])
            error = "악보 이미지를 찾는 중 오류가 발생했습니다."
        with self.transaction(write=True) as db:
            updated = db.execute("""
                UPDATE melody_jobs SET state=?, result=?, error=?, lease=NULL, updated=?
                WHERE id=? AND lease=?
            """, ("failed" if error else "ready",
                  json.dumps(result, ensure_ascii=False) if result and not error else None,
                  error, time.time(), job["id"], job["lease"]))
