from __future__ import annotations

import hmac
import json
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, String, Text, UniqueConstraint, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


DATA_DIRECTORY = Path(os.getenv("LYRICS_DATA_DIRECTORY", "data"))
DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("LYRICS_DATABASE_URL", f"sqlite:///{DATA_DIRECTORY / 'lyrics.sqlite3'}")
if not DATABASE_URL.startswith("sqlite:"):
    raise RuntimeError("이 API는 SQLite 데이터베이스만 지원합니다.")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionFactory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Lyric(Base):
    __tablename__ = "lyrics"
    __table_args__ = (UniqueConstraint("normalized_artist", "normalized_title", name="uq_lyrics_artist_title"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    artist: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_artist: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_title: Mapped[str] = mapped_column(String(255), nullable=False)
    lyrics: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2048))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(engine)

app = FastAPI(title="Yebit Lyrics API", version="0.1.0")


class LyricsImport(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    artist: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=255)
    lyrics: str = Field(min_length=1, max_length=100_000)
    source_url: str | None = Field(default=None, max_length=2048)
    authorized: bool


class LyricsResponse(BaseModel):
    id: int | None
    artist: str
    title: str
    lyrics: str
    source_url: str | None = None
    provider: str = "LOCAL"


def normalize(value: str) -> str:
    return "".join(unicodedata.normalize("NFC", value).casefold().split())


def lrclib_search(artist: str, title: str) -> list[dict]:
    search_parameters = {"track_name": title}
    if artist.strip():
        search_parameters["artist_name"] = artist
    parameters = urllib.parse.urlencode(search_parameters)
    request = urllib.request.Request(
        f"https://lrclib.net/api/search?{parameters}",
        headers={"X-User-Agent": "YebitLyricsAPI/1.0 (https://github.com/ryuyejun/worship-ppt-poc)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=6) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []
    return [record for record in payload if isinstance(record, dict)] if isinstance(payload, list) else []


def lrclib_lyrics(record: dict) -> str:
    plain = record.get("plainLyrics")
    if isinstance(plain, str) and plain.strip():
        return plain.strip()
    synced = record.get("syncedLyrics")
    if not isinstance(synced, str):
        return ""
    text = re.sub(r"^\[\d{2}:\d{2}(?:\.\d+)?\]\s*", "", synced, flags=re.MULTILINE)
    return text.strip()


def extract_lyrics(description: str) -> str:
    """Extract the strongest lyric block; ignore description copy and credits."""
    metadata_pattern = re.compile(
        r"https?://|www\.|#\w+|구독|subscribe|instagram|facebook|twitter|문의|비즈니스|"
        r"저작권|copyright|작사|작곡|편곡|제공|출처|후원|donat|contact|credit|written\s+by|words\s*(?:and|&)\s*music\s*by|앨범 소개|수록곡|lyrics by|music by|"
        r"guitar|bass|drum|cello|videographer|photograph|color.?graded|video.?edit|engineer|lighting|"
        r"vocal|mixed|mastered|arrange|location|special thanks|recorded|camera|director|producer|production|"
        r"피아워십|워십팀|세션|촬영|편집|녹화|음향|조명|마스터링|믹싱|연주|출연|음악\s*자막\s*제작|자막\s*제작|"
        r"본\s*영상은|수익\s*창출|수익\s*기능|사용하지\s*않았|수익을\s*창출|영상\s*제작|이용해\s*주셔서|시청해\s*주셔서",
        re.IGNORECASE,
    )
    lyric_heading = re.compile(
        r"^\s*[-*_=#> ]*(?:lyrics?|가사)(?:\s*(?:/|·|:|：|-|–)\s*(?:가사|lyrics?))?\s*[:：]?\s*[-*_=# ]*$",
        re.IGNORECASE,
    )
    blocks: list[list[str]] = []
    current: list[str] = []
    has_lyrics_heading = False
    for raw_line in description.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = re.sub(r"^\[\d{2}:\d{2}(?:\.\d+)?\]\s*", "", raw_line).strip()
        if not line:
            if current and current[-1] != "":
                current.append("")
            continue
        inline_heading = re.match(r"^\s*(?:lyrics?|가사)\s*[:：]\s*(\S.*)$", line, re.IGNORECASE)
        if lyric_heading.fullmatch(line) or inline_heading:
            current = []
            blocks.clear()
            has_lyrics_heading = True
            if inline_heading:
                current.append(inline_heading.group(1).strip())
            continue
        if metadata_pattern.search(line):
            if current:
                blocks.append(current)
                current = []
            if has_lyrics_heading:
                break
            continue
        if not re.search(r"[가-힣A-Za-z]", line):
            if current:
                blocks.append(current)
                current = []
            continue
        if len(line) > 30 and re.search(r"[.!?…][\"'”’)]?$", line):
            if current:
                blocks.append(current)
                current = []
            continue
        if len(line) > 110:
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(line)
    if current:
        blocks.append(current)

    def block_score(lines: list[str]) -> float:
        content = [line for line in lines if line]
        if not content:
            return float("-inf")
        hangul_lines = sum(bool(re.search(r"[가-힣]", line)) for line in content)
        prose_lines = sum(bool(len(line) > 35 and re.search(r"[.!?…][\"'”’)]?$", line)) for line in content)
        long_lines = sum(len(line) > 90 for line in content)
        average_words = sum(len(line.split()) for line in content) / len(content)
        return len(content) + hangul_lines * 1.5 - prose_lines * 3 - long_lines * 3 - max(0, average_words - 9) * 0.5

    block = max(blocks, key=block_score, default=[])
    lyrics = "\n".join(block).strip()
    if sum(bool(line) for line in block) < 5 or len(re.findall(r"[가-힣A-Za-z]", lyrics)) < 40:
        return ""
    return lyrics


def lrclib_match(artist: str, title: str) -> dict | None:
    requested_artist = normalize(artist)
    requested_title = normalize(title)
    records = lrclib_search(artist, title)
    eligible = [
        record
        for record in records
        if lrclib_lyrics(record)
        and normalize(str(record.get("trackName", ""))) == requested_title
        and normalize(str(record.get("artistName", ""))) == requested_artist
    ]
    return eligible[0] if eligible else None


def lrclib_song_results(artist: str, title: str) -> list[dict[str, str | None]]:
    output = []
    for record in lrclib_search(artist, title):
        track_name = str(record.get("trackName", "")).strip()
        artist_name = str(record.get("artistName", "")).strip()
        if not track_name or not artist_name:
            continue
        output.append(
            {
                "title": track_name,
                "artist": artist_name,
                "album": record.get("albumName"),
                "source": "LRCLIB",
                "source_url": f"https://lrclib.net/track/{record.get('id')}" if record.get("id") else "https://lrclib.net",
                "lyrics_available": bool(lrclib_lyrics(record)),
            }
        )
    return output


def result_identity(result: dict) -> tuple[str, str]:
    title = str(result.get("title", ""))
    artist = str(result.get("artist", ""))
    return normalize(title), normalize(artist)


def youtube_result_is_duplicate(result: dict, existing_results: list[dict]) -> bool:
    candidate_title = normalize(str(result.get("title", "")))
    if not candidate_title:
        return True

    candidate_artist = normalize(str(result.get("artist", "")))
    for existing in existing_results:
        existing_title, existing_artist = result_identity(existing)
        same_artist = not candidate_artist or not existing_artist or candidate_artist == existing_artist
        same_youtube_title = existing.get("source") == "YouTube" and candidate_title == existing_title
        if candidate_title == existing_title and (same_artist or same_youtube_title):
            return True
        # YouTube video titles often append labels such as “가사”, “Official MV”, or “Live”.
        if existing_title and len(existing_title) >= 3 and existing_title in candidate_title:
            return True
    return False


def youtube_title_match_score(requested_title: str, candidate_title: str) -> float:
    requested = normalize(requested_title)
    candidate = normalize(candidate_title)
    if not requested or not candidate:
        return 0.0
    if requested in candidate or candidate in requested:
        return 1.0
    tokens = {normalize(token) for token in requested_title.split() if normalize(token)}
    if not tokens:
        return 0.0
    matched = sum(1 for token in tokens if token in candidate)
    return matched / len(tokens)


def find_youtube_candidates(artist: str, title: str) -> list[dict[str, str]]:
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        return []

    parameters = urllib.parse.urlencode(
        {
            "part": "snippet",
            "q": f"{artist} {title} 가사".strip(),
            "type": "video",
            "maxResults": 10,
            "relevanceLanguage": "ko",
            "regionCode": "KR",
            "key": api_key,
        }
    )
    request = urllib.request.Request(
        f"https://www.googleapis.com/youtube/v3/search?{parameters}",
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=6) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []

    candidates: list[dict[str, str]] = []
    for item in payload.get("items", []):
        video_id = item.get("id", {}).get("videoId")
        snippet = item.get("snippet", {})
        if not video_id:
            continue
        candidates.append(
            {
                "video_id": video_id,
                "title": snippet.get("title", ""),
                "channel": snippet.get("channelTitle", ""),
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "source": "YouTube",
                "description": "",
                "lyrics": "",
            }
        )

    if not candidates:
        return candidates

    video_parameters = urllib.parse.urlencode(
        {
            "part": "snippet",
            "id": ",".join(candidate["video_id"] for candidate in candidates),
            "key": api_key,
        }
    )
    video_request = urllib.request.Request(
        f"https://www.googleapis.com/youtube/v3/videos?{video_parameters}",
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(video_request, timeout=6) as response:
            video_payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return candidates

    descriptions = {
        item.get("id"): item.get("snippet", {}).get("description", "")
        for item in video_payload.get("items", [])
    }
    for candidate in candidates:
        candidate["description"] = descriptions.get(candidate["video_id"], "")
        candidate["lyrics"] = extract_lyrics(candidate["description"])
    return candidates


def get_session() -> Generator[Session, None, None]:
    with SessionFactory() as session:
        yield session


def verify_import_token(x_import_token: str | None = Header(default=None)) -> None:
    expected = os.getenv("LYRICS_IMPORT_TOKEN")
    if not expected:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="가사 등록 기능이 설정되지 않았습니다.")
    if not x_import_token or not hmac.compare_digest(x_import_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="등록 권한이 없습니다.")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "database": "sqlite"}


@app.get("/lyrics", response_model=LyricsResponse)
def get_lyrics(
    artist: str = Query(min_length=1, max_length=255),
    title: str = Query(min_length=1, max_length=255),
    session: Session = Depends(get_session),
) -> LyricsResponse:
    normalized_artist = normalize(artist)
    normalized_title = normalize(title)
    matches = list(
        session.scalars(
            select(Lyric)
            .where(Lyric.normalized_title.contains(normalized_title))
            .order_by(Lyric.id)
        ).all()
    )
    lyric = next(
        (
            item
            for item in matches
            if item.normalized_title == normalized_title
            and item.normalized_artist == normalized_artist
        ),
        None,
    )
    if lyric is None and len(matches) == 1:
        lyric = matches[0]
    if lyric is None and len(matches) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "제목이 비슷한 곡이 여러 개 있습니다. 가수와 제목을 확인해 주세요.",
                "matches": [{"artist": item.artist, "title": item.title} for item in matches[:10]],
            },
        )
    if lyric is None:
        lrclib_record = lrclib_match(artist, title)
        if lrclib_record is not None:
            record_id = lrclib_record.get("id")
            return LyricsResponse(
                id=None,
                artist=str(lrclib_record.get("artistName", artist)),
                title=str(lrclib_record.get("trackName", title)),
                lyrics=lrclib_lyrics(lrclib_record),
                source_url=f"https://lrclib.net/track/{record_id}" if record_id else "https://lrclib.net",
                provider="LRCLIB",
            )
        candidates = find_youtube_candidates(artist, title)
        lyric_candidates = [candidate for candidate in candidates if candidate["lyrics"]]
        requested_title = normalize(title)
        matching_candidate = max(
            lyric_candidates,
            key=lambda candidate: youtube_title_match_score(title, candidate["title"]),
            default=None,
        )
        if matching_candidate and youtube_title_match_score(title, matching_candidate["title"]) < 0.5:
            matching_candidate = None
        if matching_candidate is not None:
            return LyricsResponse(
                id=None,
                artist=artist or matching_candidate["channel"],
                title=title,
                lyrics=matching_candidate["lyrics"],
                source_url=matching_candidate["url"],
                provider="YouTube",
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "message": "로컬 DB, LRCLIB 및 YouTube 영상 설명란에서 가사 형태의 본문을 찾지 못했습니다.",
                "youtube_candidates": lyric_candidates,
            },
        )
    return LyricsResponse(
        id=lyric.id,
        artist=lyric.artist,
        title=lyric.title,
        lyrics=lyric.lyrics,
        source_url=lyric.source_url,
        provider="LOCAL",
    )


@app.get("/songs/search")
def search_songs(
    artist: str = Query(default="", max_length=255),
    title: str = Query(min_length=1, max_length=255),
    session: Session = Depends(get_session),
) -> dict[str, list[dict]]:
    normalized_title = normalize(title)
    local_songs = list(
        session.scalars(
            select(Lyric).where(Lyric.normalized_title.contains(normalized_title)).order_by(Lyric.id)
        ).all()
    )
    results: list[dict] = [
        {
            "id": song.id,
            "title": song.title,
            "artist": song.artist,
            "source": "LOCAL",
            "source_url": song.source_url,
            "lyrics_available": bool(song.lyrics.strip()),
        }
        for song in local_songs
    ]
    seen = {result_identity(result) for result in results}

    for result in lrclib_song_results(artist, title):
        identity = result_identity(result)
        if identity not in seen:
            results.append(result)
            seen.add(identity)

    for result in find_youtube_candidates(artist, title):
        if not result["lyrics"].strip():
            continue
        search_result = {
            "title": result["title"],
            "artist": result["channel"],
            "source": "YouTube",
            "source_url": result["url"],
            "video_id": result["video_id"],
            "description": result["description"],
            "lyrics": result["lyrics"],
            "lyrics_available": bool(result["lyrics"]),
        }
        identity = result_identity(search_result)
        if identity not in seen and not youtube_result_is_duplicate(search_result, results):
            results.append(search_result)
            seen.add(identity)

    return {"results": results}


@app.post("/lyrics", response_model=LyricsResponse, status_code=status.HTTP_201_CREATED)
def add_lyrics(
    item: LyricsImport,
    _: None = Depends(verify_import_token),
    session: Session = Depends(get_session),
) -> LyricsResponse:
    if not item.authorized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="사용 권한을 확인한 가사만 등록할 수 있습니다.")
    artist_key = normalize(item.artist)
    title_key = normalize(item.title)
    existing = session.scalar(
        select(Lyric).where(Lyric.normalized_artist == artist_key, Lyric.normalized_title == title_key)
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="같은 가수가 부른 같은 제목의 가사가 이미 등록되어 있습니다.")
    lyric = Lyric(
        artist=item.artist,
        title=item.title,
        normalized_artist=artist_key,
        normalized_title=title_key,
        lyrics=item.lyrics,
        source_url=item.source_url,
    )
    session.add(lyric)
    session.commit()
    session.refresh(lyric)
    return LyricsResponse(
        id=lyric.id,
        artist=lyric.artist,
        title=lyric.title,
        lyrics=lyric.lyrics,
        source_url=lyric.source_url,
    )
