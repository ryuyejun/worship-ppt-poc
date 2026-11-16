# Yebit Lyrics API

로컬 SQLite의 승인된 가사를 검색하고 등록하는 FastAPI 서비스입니다. Genius 및 `syncedlyrics` 자동 수집은 연결하지 않습니다. 해당 라이브러리의 가사 취득 경로에는 페이지 스크래핑 또는 제공처별 비공식 수집이 포함될 수 있으므로, 이를 통해 가져온 전문을 자동 저장하지 않습니다.

## 실행

```sh
cd lyrics-api
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn main:app --reload --port 8001
```

기본 DB 파일은 `lyrics-api/data/lyrics.sqlite3`입니다. 다른 위치는 `LYRICS_DATA_DIRECTORY`로 지정할 수 있습니다. `LYRICS_DATABASE_URL`을 지정하는 경우에도 SQLite URL만 허용합니다.

## API

- `GET /lyrics?artist=WELOVE&title=곡제목`: 가수와 제목이 정규화되어 정확히 일치하는 로컬 가사를 조회합니다. 없으면 404를 반환합니다.
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

이 API는 현재 Cloudflare Worker/D1 웹 앱과 아직 연결되지 않았습니다. FastAPI는 Cloudflare Workers에서 직접 실행할 수 없으므로, 웹 앱과 연결하려면 Python 서비스를 실행할 별도 호스트와 HTTPS 주소가 필요합니다. Genius/syncedlyrics 검색이나 외부 가사 자동 저장은 별도 제공처의 허용된 API와 저장 조건이 확인되기 전에는 비활성 상태입니다.
