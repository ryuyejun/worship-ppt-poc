# Yebit 자동 멜로디

곡을 선택하면 웹 편집기가 가사 PPT를 먼저 생성합니다. 분석 API는 접수와 결과 조회를 처리합니다.

| 요청 | 응답 |
| --- | --- |
| `POST /api/auto-melody/jobs?title=…&artist=…` | 새 분석 또는 진행 중인 작업은 작업 ID와 상태를 `202`로 반환합니다. 완료된 곡은 최신 악보를 `200`으로 반환합니다. |
| `POST /api/auto-melody/jobs/upload?title=…&artist=…` | 최대 20 MiB의 음원 바이트를 접수합니다. 동일 파일은 해시를 포함해 식별합니다. |
| `GET /api/auto-melody/jobs/{jobId}` | 대기, 분석 중, 완료 또는 실패 상태를 반환합니다. 완료 응답에는 악보 JSON과 버전 번호가 포함됩니다. |
| `PUT /api/auto-melody/jobs/{jobId}` | 현재 `revision`과 수정한 `notes`를 받아 새 버전을 저장합니다. 선택적으로 `key`에 조표를, `lyricsStart`에 첫 가사가 붙는 음표의 0부터 시작하는 번호를 지정할 수 있습니다. 새 수정본이 이미 존재하면 `409`를 반환합니다. |

음표는 `pitch`(MIDI 음높이), `startTime`, `duration`(초), `amplitude`, 선택적인 `beats`로 구성됩니다. `reviewed`는 사용자가 공유 저장한 수정본을 뜻합니다. 이전 `GET /api/auto-melody?title=…` 호출은 호환용입니다.

## 실행

Python 3.11, FFmpeg 및 yt-dlp에서 지원하는 JavaScript 런타임(예: Node.js 또는 Deno)이 서버의 PATH에 필요합니다. yt-dlp 기본 의존성을 설치하며 Demucs 모델은 첫 실행에 내려받습니다. CPU에서 실행하므로 배포 장비에서 전체 곡 처리 시간을 확인하세요.

```sh
cd melody-api
python3.11 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8090
```

Vite의 기본 프록시 대상은 `http://127.0.0.1:8090`입니다. 바꾸려면 `VITE_AUTO_MELODY_TARGET`을 설정합니다.

기존 테스트 환경의 로그인과 가사 데이터를 쓰면서 이 컴퓨터에서 멜로디 분석을 실행하려면, 프로젝트 루트에서 다음 명령으로 웹을 엽니다.

```sh
VITE_API_TARGET=https://yebit-web-test.yjryu.workers.dev npm --prefix frontend run dev -- --host localhost --port 5173
```

브라우저에서 [로컬 예빗](http://localhost:5173/)에 로그인하고, 검색한 곡을 제작 목록에 추가합니다. 처음 분석하는 곡은 시간이 걸릴 수 있습니다.

악보 패널의 **자동 채보 초안 편집**에서 음표와 길이를 수정한 뒤 공유 악보에 저장할 수 있습니다. 이후 같은 제목과 아티스트로 요청하면 저장 버전이 제공됩니다. 파일 분석은 같은 음원을 올리면 동일한 작업으로 연결합니다.

`MELODY_CONCURRENCY`의 기본값은 2이며 동시에 처리할 작업 수를 조절합니다. `MELODY_THREADS`는 각 분석 프로세스의 BLAS/OpenMP 스레드 설정을 조절합니다. 작업당 분석 제한은 180초입니다.

배포할 때는 분석 서버 HTTPS 주소를 Worker의 `AUTO_MELODY_ORIGIN`에 설정하고 양쪽에 같은 `AUTO_MELODY_TOKEN`을 비밀값으로 넣으세요. 이 구성은 단일 호스트에서 SQLite를 공유하는 작업 워커를 지원합니다. `MELODY_CACHE_PATH`은 영구 볼륨의 파일 경로로 설정합니다. 여러 호스트에서 작업을 처리하려면 공용 DB와 큐가 필요합니다.

음원과 보컬 트랙은 임시 경로에서 처리합니다. 업로드 큐에 담은 파일 레코드는 분석의 완료나 실패 후 삭제하고, 악보 JSON은 버전별로 보관합니다. 음원 선택, 조성 추정 및 가사와 음표의 배치는 자동 추정이므로 편곡에 따라 원본과 다를 수 있습니다.
