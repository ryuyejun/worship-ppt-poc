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
