"""Lightweight, deterministic subtitle-to-lyrics filtering (no AI/API calls)."""

from __future__ import annotations

import logging
import math
import re
from html import unescape

logger = logging.getLogger(__name__)

_VTT_TAG = re.compile(r"</?[a-zA-Z][\w.:-]*(?:\s+[^<>]*)?\s*/?>|<\d{2}:\d{2}(?::\d{2})?\.\d{3}>")
_LINE_BREAK = re.compile(r"<br\s*/?>", re.IGNORECASE)
_BRACKETED = re.compile(r"\[([^\[\]\n]*)\]|\(([^()\n]*)\)|\*\*([^*\n]*)\*\*")
_DIRECTION = re.compile(
    r"^(?:\d+\s*절|전주|간주|후주|인트로|아웃트로|브릿지|브리지|후렴|코러스|벌스|"
    r"음악|연주|박수(?:\s*소리)?|웃음(?:\s*소리)?|환호|효과음|침묵|숨소리|기침|"
    r"노래\s*(?:시작|종료)|soft\s+music|background\s+music|instrumental|"
    r"applause|clapping|laughter|crowd|cheering|sound\s+effects?|silence|inaudible|"
    r"verse\s*\d*|chorus|bridge|intro|outro|music|instrumental break)\s*[.!…:：-]*$",
    re.IGNORECASE,
)
_CREDIT = re.compile(
    r"작사|작곡|편곡|제작\s*[:：]|음악\s*자막\s*제작|영상\s*제작|"
    r"provided\s+to\s+youtube|lyrics?|composed|arranged|written\s+by|"
    r"produced\s+by|music\s+by|copyright|subscribe|구독|좋아요",
    re.IGNORECASE,
)
_INTRO_ENDINGS = re.compile(r"(?:입니다|습니다|합니다|됩니다|드립니다|바랍니다)[.!?…。！]?$", re.IGNORECASE)
_INTRO_KEYWORDS = re.compile(
    r"진행된|영상|실황|라이브|\blive\b|스튜디오|예배|특송|첫\s*번째|첫번째|두\s*번째|두번째",
    re.IGNORECASE,
)
_TITLE_SPLIT = re.compile(r"[^\w가-힣]+", re.UNICODE)
_TITLE_GENERIC = {
    "live", "라이브", "가사", "lyrics", "official", "공식", "영상", "뮤직비디오", "mv",
    "4k", "hd", "audio", "노래", "찬양", "워십", "예배", "자막",
}
_MUSIC_MARKS = str.maketrans("", "", "♪♫♬♩")


class LyricsExtractionError(RuntimeError):
    """Raised when subtitle cues cannot be normalized."""


def _is_wrapped_direction(content: str) -> bool:
    normalized = " ".join(content.split()).strip()
    return not normalized or bool(_DIRECTION.fullmatch(normalized))


def _remove_wrapped_direction(match: re.Match[str]) -> str:
    content = next((group for group in match.groups() if group is not None), "")
    # Parentheses and square brackets commonly mark stage directions/section labels.
    # Bold markup is formatting, so retain its words unless they are a known direction.
    return " " if _is_wrapped_direction(content) else content


def _normalize_text(raw: str) -> list[str]:
    text = unescape(raw).replace("\r\n", "\n").replace("\r", "\n")
    text = _LINE_BREAK.sub("\n", text)
    text = _VTT_TAG.sub("", text)
    return [" ".join(line.split()) for line in text.split("\n")]


class LyricsFilter:
    """Five-stage, pure-Python filter for common non-lyric subtitle noise."""

    def __init__(self, *, intro_gap_seconds: float = 3.5, intro_window_seconds: float = 45.0) -> None:
        self.intro_gap_seconds = intro_gap_seconds
        self.intro_window_seconds = intro_window_seconds

    @staticmethod
    def _title_keywords(video_title: str | None) -> set[str]:
        if not video_title:
            return set()
        words = {
            word.casefold()
            for word in _TITLE_SPLIT.split(unescape(video_title))
            if len(word) >= 2 and word.casefold() not in _TITLE_GENERIC
        }
        return words

    @staticmethod
    def _contains_two_title_keywords(line: str, keywords: set[str]) -> bool:
        if len(keywords) < 2:
            return False
        normalized = line.casefold()
        return sum(keyword in normalized for keyword in keywords) >= 2

    def clean(self, subtitles: list[dict], video_title: str | None = None) -> list[str]:
        if not isinstance(subtitles, list):
            raise TypeError("subtitles must be a list")
        if video_title is not None and not isinstance(video_title, str):
            raise TypeError("video_title must be a string or None")

        cues: list[tuple[float, float, list[str]]] = []
        for cue in subtitles:
            if not isinstance(cue, dict):
                continue
            start, duration, raw = cue.get("start"), cue.get("duration"), cue.get("text")
            if not all(
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                and value >= 0
                for value in (start, duration)
            ) or not isinstance(raw, str):
                continue
            lines: list[str] = []
            for line in _normalize_text(raw):
                line = _BRACKETED.sub(_remove_wrapped_direction, line).translate(_MUSIC_MARKS)
                line = " ".join(line.split()).strip()
                if not line or _CREDIT.search(line):
                    continue
                if any(character.isalnum() for character in line):
                    lines.append(line)
            # Keep timing-only cues through the gap stage: an intervening credit
            # or stage-direction cue must still count as the previous subtitle.
            cues.append((float(start), float(duration), lines))

        cues.sort(key=lambda cue: cue[0])
        if len(cues) < len(subtitles):
            logger.debug("Ignored %d invalid, empty, or noise subtitle cues", len(subtitles) - len(cues))

        # Stage 2: cut at the first clear transition from opening speech/prelude to
        # the song. The cue after the silence is retained.
        cutoff = 0
        for index in range(1, len(cues)):
            current_start = cues[index][0]
            previous_end = cues[index - 1][0] + cues[index - 1][1]
            if current_start <= self.intro_window_seconds and current_start - previous_end >= self.intro_gap_seconds:
                cutoff = index
                break
        cues = cues[cutoff:]

        # Stage 3 and 4 apply only to the intro area. Stage 3 uses the first six
        # retained cue lines OR timestamps before 35 seconds, as requested.
        keywords = self._title_keywords(video_title)
        results: list[str] = []
        inspected_line_count = 0
        for start, _duration, lines in cues:
            for line in lines:
                intro_scope = inspected_line_count < 6 or start < 35.0
                inspected_line_count += 1
                if intro_scope and (_INTRO_ENDINGS.search(line) or _INTRO_KEYWORDS.search(line)):
                    continue
                if start < 35.0 and self._contains_two_title_keywords(line, keywords):
                    continue
                results.append(line)

        # Stage 5: normalization above removes blank lines; keep this final trim
        # explicit so callers always get a compact list.
        while results and not results[0].strip():
            results.pop(0)
        while results and not results[-1].strip():
            results.pop()
        logger.debug("LyricsFilter retained %d of %d subtitle cues", len(results), len(subtitles))
        return results


class RuleBasedCleaner(LyricsFilter):
    """Backward-compatible alias for earlier preview clients."""


def extract_clean_lyrics(subtitles: list[dict], video_title: str | None = None) -> list[str]:
    """Return deterministic lyrics without calling any external model/API."""
    try:
        return LyricsFilter().clean(subtitles, video_title=video_title)
    except Exception as error:
        logger.exception("Rule-based subtitle lyrics extraction failed")
        raise LyricsExtractionError("자막 정제에 실패했습니다.") from error
