# Yebit Lyrics API

로컬 SQLite의 승인된 가사를 검색하고 등록하는 FastAPI 서비스입니다. 로컬 가사 검색에서 결과가 없고 `YOUTUBE_API_KEY`가 설정된 경우, 공식 YouTube Data API v3로 상위 영상 후보와 설명 텍스트를 조회해 응답으로만 반환합니다. 설명 텍스트는 SQLite에 저장하지 않습니다.

## 실행

```sh
cd lyrics-api
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn main:app --reload --port 8001
```

기본 DB 파일은 `lyrics-api/data/lyrics.sqlite3`입니다. 다른 위치는 `LYRICS_DATA_DIRECTORY`로 지정할 수 있습니다. `LYRICS_DATABASE_URL`을 지정하는 경우에도 SQLite URL만 허용합니다.

YouTube 후보 검색을 사용하려면 서버 프로세스에 `YOUTUBE_API_KEY` 환경변수를 설정합니다. 키를 코드나 프론트엔드에 넣지 마세요.

## API

- `GET /lyrics?artist=WELOVE&title=곡제목`: 먼저 제목 부분 일치로 로컬 가사를 검색하고, 결과가 있으면 즉시 반환합니다. 없으면 공식 `https://www.googleapis.com/youtube/v3/search`로 `"{artist} {title} 가사"`를 검색한 뒤 `https://www.googleapis.com/youtube/v3/videos?part=snippet`으로 최대 3개 후보의 설명을 조회해 404 응답의 `youtube_candidates`에 제목, 채널명, 링크, 설명을 담습니다. 이 응답은 임시로 제공되며 서비스는 설명을 DB나 캐시에 저장하지 않습니다. `YOUTUBE_API_KEY`가 없거나 조회에 실패하면 설명 또는 후보 목록은 비어 있습니다.
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

YouTube 검색 후보 설명은 조회 시점에만 반환하며 SQLite에 저장하지 않습니다. 등록은 사용자가 설명을 검토한 뒤 기존 `POST /lyrics`에 권한 확인과 등록 토큰을 제공해야 합니다. YouTube API 데이터 보관 정책은 API 데이터를 일반적으로 최대 30일까지만 저장하도록 제한합니다. [YouTube API 데이터 저장 정책](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content)

이 API는 현재 Cloudflare Worker/D1 웹 앱과 아직 연결되지 않았습니다. FastAPI는 Cloudflare Workers에서 직접 실행할 수 없으므로, 웹 앱과 연결하려면 Python 서비스를 실행할 별도 호스트와 HTTPS 주소가 필요합니다. Genius/syncedlyrics 가사 자동 수집은 제공처의 허용된 사용 및 저장 조건이 확인되기 전까지 비활성 상태입니다.
