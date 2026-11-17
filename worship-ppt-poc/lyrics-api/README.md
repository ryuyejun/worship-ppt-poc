# Yebit Lyrics API

로컬 SQLite의 승인된 가사를 검색하고 등록하는 FastAPI 서비스입니다. 가사 조회는 로컬 SQLite → LRCLIB → YouTube 영상 설명란의 가사 후보 순서로 진행합니다. LRCLIB와 YouTube에서 찾은 가사는 응답으로만 반환하고 자동 저장하지 않습니다.

## 실행

```sh
cd lyrics-api
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn main:app --reload --port 8001
```

기본 DB 파일은 `lyrics-api/data/lyrics.sqlite3`입니다. 다른 위치는 `LYRICS_DATA_DIRECTORY`로 지정할 수 있습니다. `LYRICS_DATABASE_URL`을 지정하는 경우에도 SQLite URL만 허용합니다.

LRCLIB 검색은 공개 API를 사용합니다. LRCLIB에 결과가 없거나 요청 오류·한도 초과(HTTP 429)가 발생하면 YouTube로 넘어갑니다. YouTube 후보 검색을 사용하려면 서버 프로세스에 `YOUTUBE_API_KEY` 환경변수를 설정합니다. 키를 코드나 프론트엔드에 넣지 마세요.

## API

- `GET /lyrics?artist=WELOVE&title=곡제목`: 로컬 SQLite에서 먼저 찾고, 없으면 LRCLIB에서 제목·가수가 정확히 일치하는 가사를 반환합니다. LRCLIB 조회가 실패하거나 429 한도 초과, 정확한 가사 결과 없음이면 YouTube 상위 영상 설명란을 조회해 5줄 이상인 가사형 본문을 찾고 응답합니다. 응답의 `provider`는 `LOCAL`, `LRCLIB`, `YouTube` 중 하나입니다. 가사를 찾지 못하면 404와 함께 확인용 후보를 반환합니다.
- `GET /songs/search?title=곡제목&artist=WELOVE`: 로컬, LRCLIB, YouTube 검색 결과를 합쳐 반환합니다. `artist`는 선택값입니다. 제목·가수를 정규화해 중복을 제거하고, YouTube 영상 설명란에서 추출한 가사 본문도 각 후보의 `lyrics`에 담습니다. 가사는 자동으로 DB에 저장하지 않습니다. 프론트엔드에서는 입력 중 매 글자마다 호출하지 말고 검색 실행 시 호출하는 방식이 적합합니다.
- `POST /lyrics`: 권한을 확인한 가사를 등록합니다. 서버에서 `LYRICS_IMPORT_TOKEN`을 설정하고 요청에 같은 `X-Import-Token` 헤더를 보내야 합니다. 가수·제목 조합이 중복되면 기존 가사를 덮어쓰지 않고 409를 반환합니다.
- `GET /health`: 서비스 상태를 확인합니다.
- `GET /docs`: 대화형 API 문서입니다.

가사 등록 요청 예시:

```json
{
  "artist": "WELOVE",
  "title": "곡 제목",
  "lyrics": "사용 권한이 확인된 가사",
  "source_url": "https://example.org/source",
  "authorized": true
}
```

LRCLIB와 YouTube에서 가져온 가사 본문은 조회 시점에만 반환하며 SQLite에 저장하지 않습니다. 등록은 사용자가 가사 사용 권한을 확인한 뒤 기존 `POST /lyrics`에 등록 토큰과 함께 직접 제공해야 합니다. YouTube API 데이터 보관 정책은 API 데이터를 일반적으로 최대 30일까지만 저장하도록 제한합니다. [YouTube API 데이터 저장 정책](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content)

이 API는 현재 Cloudflare Worker/D1 웹 앱과 아직 연결되지 않았습니다. FastAPI는 Cloudflare Workers에서 직접 실행할 수 없으므로, 웹 앱과 연결하려면 Python 서비스를 실행할 별도 호스트와 HTTPS 주소가 필요합니다. Genius/syncedlyrics 가사 자동 수집은 제공처의 허용된 사용 및 저장 조건이 확인되기 전까지 비활성 상태입니다.

## 자막에서 가사 추출

이미 파싱한 JSON 또는 VTT 자막의 큐 목록을 Python에서 처리할 수 있습니다.
각 큐에는 초 단위의 `start`, `duration`과 문자열 `text`를 넣습니다.

```sh
cd lyrics-api
python -m pip install '.[subtitles]'
```

로컬에서 `uvicorn main:app --host 127.0.0.1 --port 8001`을 실행하고
[자막 가사 추출 화면](http://127.0.0.1:8001/subtitle-lyrics)을 엽니다.
Vite 개발 서버를 실행 중이라면 [localhost:5173/subtitle-lyrics](http://localhost:5173/subtitle-lyrics)에서도 열 수 있습니다.
예제 자막으로 바로 실행하거나 JSON 파일을 올릴 수 있습니다. **규칙 정제 미리보기**에는
API 키가 필요하지 않습니다. **모델로 가사 추출**은 아래 모델 설정을 사용합니다.

로컬 LLM 호출을 위해 `lyrics-api/.env` 파일에 `OPENAI_API_KEY`를 설정합니다.
이 파일은 Git에 포함되지 않습니다. 모델은 `LYRICS_LLM_MODEL`로 바꿀 수 있고,
호환 서버의 주소는 `OPENAI_BASE_URL`로 지정합니다.

```python
import json
from pathlib import Path

from subtitle_lyrics import extract_clean_lyrics

subtitles = json.loads(Path("subtitles.json").read_text(encoding="utf-8"))
lyrics = extract_clean_lyrics(subtitles)
```

정제된 자막은 설정한 모델 서버에 전송됩니다. 기본값은 Structured Outputs이고,
JSON 모드만 제공하는 서버에서는 `RuleBasedCleaner().clean(subtitles)`의 결과를
`LLMLyricsExtractor(client=client, model="모델 이름", json_mode=True).extract(lines)`에
전달할 수 있습니다. 가사를 찾지 못하면 빈 리스트를 반환하고, API 오류나 유효하지
않은 모델 응답은 `LyricsExtractionError`로 알립니다.
