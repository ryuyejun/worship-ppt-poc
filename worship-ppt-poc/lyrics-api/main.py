from __future__ import annotations

import hmac
import os
import unicodedata
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
    id: int
    artist: str
    title: str
    lyrics: str
    source_url: str | None


def normalize(value: str) -> str:
    return "".join(unicodedata.normalize("NFC", value).casefold().split())


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
    statement = select(Lyric).where(
        Lyric.normalized_artist == normalize(artist),
        Lyric.normalized_title == normalize(title),
    )
    lyric = session.scalar(statement)
    if lyric is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="로컬 DB에서 가사를 찾을 수 없습니다.")
    return LyricsResponse(
        id=lyric.id,
        artist=lyric.artist,
        title=lyric.title,
        lyrics=lyric.lyrics,
        source_url=lyric.source_url,
    )


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
