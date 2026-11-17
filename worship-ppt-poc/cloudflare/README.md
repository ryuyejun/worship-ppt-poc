# Cloudflare 구성

`wrangler.web.test.jsonc`는 공개 테스트 Worker와 D1 데이터베이스 `yebit-test`를 연결합니다. 곡 검색과 가사 조회, 검색 요청 대기열, Pixabay 이미지 검색을 처리합니다. Pixabay 키는 `PIXABAY_API_KEY` Workers 비밀 변수에 저장하고 저장소에는 기록하지 않습니다. 무분별한 쓰기를 막기 위해 일괄 등록 및 요청 완료는 비활성화했습니다.

```sh
npm --prefix frontend run build
node --test cloudflare/test/songs.test.mjs
npx wrangler dev --config cloudflare/wrangler.web.test.jsonc
npx wrangler deploy --config cloudflare/wrangler.web.test.jsonc
```

`schema.sql`은 곡·별칭·요청 테이블이며 `migrations/0002-song-artwork-cache.sql`은 이미지 캐시 테이블입니다. `tools/export-mysql.mjs` 및 `tools/sqlite-to-d1.mjs`는 과거 MySQL 자료를 D1으로 옮기는 보조 도구입니다. 내보낸 자료에는 가사가 포함되므로 안전하게 보관하고 저장소에 올리지 마세요.

## YouTube 영상 통계

`migrations/0004-youtube-statistics.sql`을 적용하고 `YOUTUBE_API_KEY`를 Worker 비밀 변수로 설정한다. 확인된 영상 ID를 `youtube_videos`에 등록하면 한국 시간 매주 월요일 00:00에 `videos.list`로 조회수와 좋아요 원본을 갱신한다. `song_id`는 확인된 경우에만 연결한다. 한 영상의 최신 값만 보관하며 30일이 지난 통계는 삭제한다. 좋아요가 제공되지 않으면 NULL로 저장한다. 수집 대상이 없으면 통계도 없다. 순위와 증가량은 계산하지 않는다.

`0005-youtube-channels.sql`도 적용하면 `youtube_channels`에 등록된 채널별 최근 업로드 최대 10개를 매주 찾아 추가한다. 영상 제목은 YouTube 원본 그대로 저장하므로 합곡·예배 전체 영상도 표시할 수 있다. 전체 영상의 통계를 첫 곡의 통계로 잘못 연결하지 않으며, `song_id`는 별도로 확인한 경우에만 설정한다.

곡 검색의 `POST /providers/search`는 검색 후보의 영상 설명을 YouTube `videos.list`로 추가 조회하고, URL·홍보·출처 안내를 제외한 5줄 이상의 가사형 본문을 응답에 포함한다. 이 본문은 검색 결과와 미리보기에만 사용하며 D1에 저장하지 않는다. 검색 결과에서 가사 본문을 확인할 수 있는 후보를 선택하면 기존 PPT 제작 흐름에서 사용할 수 있다.

트렌드·최근·즐겨찾기에서 가사가 비어 있는 등록곡을 선택하면 `POST /song-lyrics`가 D1 → LRCLIB → YouTube 영상 설명란 순으로 가사를 조회한다. 외부에서 찾은 가사는 일시적으로 반환하고 D1에 저장하지 않으며, PPT 제작 목록에는 외부 가사 입력으로 포함한다.

## MIDI 악보 검색

`GET /api/midi/search?title=Amazing+Grace`는 제목과 별칭으로 등록된 MIDI를 찾아 기존 `{ success, data, error }` 형식으로 반환합니다. 제목은 1~120자이며 일치하는 곡이 없으면 `data: []`를 반환합니다. 검색 결과에는 곡 제목, 출처 URL, BPM과 트랙별 음표가 들어 있습니다. 각 음표에는 MIDI 번호, 고정도법 계이름(C=도), 옥타브, 시작 시간, 재생 길이, 악보용 박 길이가 포함됩니다.

초기 자료는 CCEL의 공개 찬송가 MIDI 3곡입니다. 원본 MIDI와 출처는 `src/midi-catalog.json`에 있습니다. MIDI 검색은 악보 시험 화면에서 로그인 없이 사용 가능하며 기존 API 요청 제한을 따릅니다.
