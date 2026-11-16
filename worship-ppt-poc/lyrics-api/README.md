# Yebit Lyrics API

로컬 SQLite의 승인된 가사를 검색하고 등록하는 FastAPI 서비스입니다. 가사 조회는 로컬 SQLite → LRCLIB → YouTube 영상 후보 순서로 진행합니다. LRCLIB 가사는 응답으로만 반환하고 자동 저장하지 않습니다. YouTube 영상 후보와 설명도 응답으로만 반환합니다.

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

- `GET /lyrics?artist=WELOVE&title=곡제목`: 로컬 SQLite에서 먼저 찾고, 없으면 LRCLIB에서 제목·가수가 정확히 일치하고 가사가 있는 결과를 반환합니다. LRCLIB 조회가 실패하거나 429 한도 초과, 정확한 가사 결과 없음이면 YouTube로 넘어갑니다. YouTube 후보는 404 응답의 `youtube_candidates`에 제목, 채널명, 링크, 설명을 담으며 DB나 캐시에 저장하지 않습니다. 응답의 `provider`는 `LOCAL` 또는 `LRCLIB`입니다.
- `GET /songs/search?title=곡제목&artist=WELOVE`: 로컬, LRCLIB, YouTube 검색 결과를 합쳐 반환합니다. `artist`는 선택값입니다. 제목·가수를 정규화해 중복을 제거하고, YouTube 영상 제목에 이미 반환된 곡 제목이 포함된 경우도 중복 후보로 제외합니다. 이 검색은 YouTube API 키가 설정된 경우 YouTube 검색을 호출하므로 프론트엔드에서는 입력 중 매 글자마다 호출하지 말고 검색 실행 시 호출하는 방식이 적합합니다.
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

LRCLIB에서 가져온 가사와 YouTube 검색 후보 설명은 조회 시점에만 반환하며 SQLite에 저장하지 않습니다. 등록은 사용자가 가사 사용 권한을 확인한 뒤 기존 `POST /lyrics`에 등록 토큰과 함께 직접 제공해야 합니다. YouTube API 데이터 보관 정책은 API 데이터를 일반적으로 최대 30일까지만 저장하도록 제한합니다. [YouTube API 데이터 저장 정책](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content)

이 API는 현재 Cloudflare Worker/D1 웹 앱과 아직 연결되지 않았습니다. FastAPI는 Cloudflare Workers에서 직접 실행할 수 없으므로, 웹 앱과 연결하려면 Python 서비스를 실행할 별도 호스트와 HTTPS 주소가 필요합니다. Genius/syncedlyrics 가사 자동 수집은 제공처의 허용된 사용 및 저장 조건이 확인되기 전까지 비활성 상태입니다.
