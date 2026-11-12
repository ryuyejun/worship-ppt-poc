# Cloudflare 구성

`wrangler.web.test.jsonc`는 공개 테스트 Worker와 D1 데이터베이스 `yebit-test`를 연결합니다. 곡 검색과 가사 조회, 검색 요청 대기열, Pixabay 이미지 검색을 처리합니다. Pixabay 키는 `PIXABAY_API_KEY` Workers 비밀 변수에 저장하고 저장소에는 기록하지 않습니다. 무분별한 쓰기를 막기 위해 일괄 등록 및 요청 완료는 비활성화했습니다.

```sh
npm --prefix frontend run build
node --test cloudflare/test/songs.test.mjs
npx wrangler dev --config cloudflare/wrangler.web.test.jsonc
npx wrangler deploy --config cloudflare/wrangler.web.test.jsonc
```

`schema.sql`은 곡·별칭·요청 테이블이며 `migrations/0002-song-artwork-cache.sql`은 이미지 캐시 테이블입니다. `tools/export-mysql.mjs` 및 `tools/sqlite-to-d1.mjs`는 과거 MySQL 자료를 D1으로 옮기는 보조 도구입니다. 내보낸 자료에는 가사가 포함되므로 안전하게 보관하고 저장소에 올리지 마세요.
