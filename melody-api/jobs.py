import hashlib
import json
import logging
import re
import sqlite3
import subprocess
import time
import unicodedata
from contextlib import contextmanager
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from melody_filter import fit_treble_register
from sheet_images import SHEET_CACHE_VERSION

logger = logging.getLogger(__name__)


def normalize(text):
    return " ".join(unicodedata.normalize("NFC", text).split())


class ScoreNote(BaseModel):
    pitch: int = Field(ge=0, le=127, strict=True)
    startTime: float = Field(ge=0, le=900)
    duration: float = Field(gt=0, le=120)
    amplitude: float = Field(ge=0, le=1)
    beats: float | None = Field(default=None, gt=0, le=16)


class ScoreRevision(BaseModel):
    key: str | None = Field(default=None, pattern=r"^(?:C|Db|D|Eb|E|F|F#|Gb|G|Ab|A|Bb|B|Cm|C#m|Dm|Ebm|Em|Fm|F#m|Gm|G#m|Am|Bbm|Bm)$")
    lyricsStart: int | None = Field(default=None, ge=0, le=5999)
    revision: int = Field(ge=1)
    notes: list[ScoreNote] = Field(min_length=1, max_length=6000)

    @model_validator(mode="after")
    def monophonic(self):
        if self.lyricsStart is not None and self.lyricsStart >= len(self.notes):
            raise ValueError("Lyrics start must point to an existing note")
        for previous, current in zip(self.notes, self.notes[1:]):
            if previous.startTime + previous.duration > current.startTime + 0.0002:
                raise ValueError("Notes must be ordered without overlapping")
        return self


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
                    revision INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS melody_job_queue ON melody_jobs(state, updated);
                CREATE TABLE IF NOT EXISTS melody_audio (
                    job_id TEXT PRIMARY KEY,
                    content BLOB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS melody_revisions (
                    job_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    result TEXT NOT NULL,
                    PRIMARY KEY (job_id, revision)
                );
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(melody_jobs)")}
            if "video_id" not in columns:
                db.execute("ALTER TABLE melody_jobs ADD COLUMN video_id TEXT")

    def submit(self, title, artist, audio=None, video_id=None):
        title, artist = normalize(title), normalize(artist)
        if not title:
            raise HTTPException(400, "A song title is required")
        if video_id is not None and not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise HTTPException(422, "A valid YouTube video ID is required")
        # Version the identity so scores without audio-derived vocal boundaries
        # cannot be reused for the anchored score/caption pipeline.
        audio_hash = hashlib.sha256(audio).hexdigest() if audio else None
        song = [title.casefold(), artist.casefold(), audio_hash]
        key = hashlib.sha256(json.dumps([SHEET_CACHE_VERSION if not audio else "notation-v2", video_id if audio else None, *song]).encode()).hexdigest()
        previous_key = hashlib.sha256(json.dumps(["mono-v2", *song]).encode()).hexdigest()
        with self.transaction() as db:
            # Keep user edits. Unreviewed scores from the previous model are regenerated.
            reviewed = db.execute("""
                SELECT j.id, r.result FROM melody_jobs j JOIN melody_revisions r
                ON r.job_id=j.id AND r.revision=j.revision
                WHERE j.song_key=? AND j.state='ready' AND j.revision>1
            """, (previous_key,)).fetchone()
            current = db.execute("SELECT id, state FROM melody_jobs WHERE song_key=?", (key,)).fetchone()
        if reviewed and audio:
            legacy_score = json.loads(reviewed["result"])
            if isinstance(legacy_score.get("vocalStartSec"), (int, float)) and isinstance(
                legacy_score.get("vocalEndSec"), (int, float)
            ):
                return self.get(reviewed["id"])
        if current and current["state"] != "failed":
            return self.get(current["id"])
        with self.transaction(write=True) as db:
            db.execute("""
                INSERT INTO melody_jobs (id, song_key, title, artist, video_id, updated) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(song_key) DO UPDATE SET state='queued', updated=excluded.updated, error=NULL
                WHERE melody_jobs.state='failed'
            """, (uuid4().hex, key, title, artist, video_id, time.time()))
            job_id = db.execute("SELECT id FROM melody_jobs WHERE song_key=?", (key,)).fetchone()["id"]
            if audio and db.execute("SELECT state FROM melody_jobs WHERE id=?", (job_id,)).fetchone()["state"] == "queued":
                db.execute("INSERT OR IGNORE INTO melody_audio VALUES (?, ?)", (job_id, audio))
        return self.get(job_id)

    def get(self, job_id):
        with self.transaction() as db:
            row = db.execute("""
                SELECT j.id, j.state, j.error, j.revision, r.result
                FROM melody_jobs j LEFT JOIN melody_revisions r
                ON r.job_id=j.id AND r.revision=j.revision WHERE j.id=?
            """, (job_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Melody job not found")
        outcome = {"jobId": row["id"], "state": row["state"]}
        if row["result"]:
            score = json.loads(row["result"])
            if score.get("sourceType") != "sheet-image": score["musicxmlUrl"] = f"/api/auto-melody/jobs/{job_id}/musicxml"
            if not score.get("reviewed") and "notationTransposeSemitones" not in score:
                score["notationTransposeSemitones"] = fit_treble_register(score["notes"])
            outcome.update(revision=row["revision"], score=score)
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
            with self.transaction() as db:
                source = db.execute("SELECT content FROM melody_audio WHERE job_id=?", (job["id"],)).fetchone()
            result = analyze(job["title"], job["artist"], source["content"] if source else None,
                             job["video_id"])
            if result and result.get('sourceType') != 'sheet-image':
                from notation import export_musicxml
                from pathlib import Path
                export_musicxml(result, Path(self.path).parent / 'musicxml' / job['id'] / 'output_sheet.musicxml')
            if not result:
                error = "이 곡의 악보 이미지를 찾지 못했습니다."
        except ValueError as exc:
            error = str(exc)
        except subprocess.TimeoutExpired:
            error = "악보 분석 시간이 초과됐습니다."
        except Exception:
            logger.exception("Melody analysis failed for %s", job["id"])
            error = "악보 이미지를 인식하는 중 오류가 발생했습니다."
        with self.transaction(write=True) as db:
            updated = db.execute("""
                UPDATE melody_jobs SET state=?, revision=?, error=?, lease=NULL, updated=?
                WHERE id=? AND lease=?
            """, ("failed" if error else "ready", 0 if error else 1, error,
                  time.time(), job["id"], job["lease"]))
            if updated.rowcount:
                db.execute("DELETE FROM melody_audio WHERE job_id=?", (job["id"],))
            if updated.rowcount and result:
                result["reviewed"] = False
                db.execute("INSERT INTO melody_revisions VALUES (?, 1, ?)", (job["id"], json.dumps(result)))

    def revise(self, job_id, edit):
        with self.transaction(write=True) as db:
            row = db.execute("""
                SELECT j.revision, r.result FROM melody_jobs j JOIN melody_revisions r
                ON r.job_id=j.id AND r.revision=j.revision WHERE j.id=? AND j.state='ready'
            """, (job_id,)).fetchone()
            if not row or row["revision"] != edit.revision:
                raise HTTPException(409, "Score revision changed")
            result = json.loads(row["result"])
            result.update(notes=[note.model_dump(exclude_none=True) for note in edit.notes], reviewed=True)
            for field in ("key", "lyricsStart"):
                if field in edit.model_fields_set:
                    result[field] = getattr(edit, field)
            revision = edit.revision + 1
            db.execute("INSERT INTO melody_revisions VALUES (?, ?, ?)", (job_id, revision, json.dumps(result)))
            db.execute("UPDATE melody_jobs SET revision=?, updated=? WHERE id=?", (revision, time.time(), job_id))
        return self.get(job_id)
