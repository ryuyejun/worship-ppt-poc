# Cloudflare 전환 준비

이 폴더는 기존 MySQL 데이터를 D1으로 이전하기 위한 준비 단계입니다. 테스트 D1과 곡 조회 Worker 초안이 준비되어 있습니다. Access 설정, 화면 연결, PPT 생성 전환 및 배포는 아직 완료되지 않았습니다.

`schema.sql`은 기존 곡·별칭·요청 데이터를 보존하는 SQLite 호환 스키마입니다. `tools/export-mysql.mjs`는 로컬 MySQL을 읽기 전용으로 조회해 새 SQLite 파일을 만듭니다. 출력 파일이 이미 있으면 덮어쓰지 않습니다. 파일에는 가사가 포함되므로 안전하게 보관하고 Git에 올리지 마세요.

Node.js 22.13 이상에서:

```sh
npm install --prefix cloudflare
node cloudflare/tools/export-mysql.mjs '/path/to/mysql.properties' '/secure/path/yebit-backup.sqlite'
sqlite3 '/secure/path/yebit-backup.sqlite' 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

기존 MySQL에 저장된 ID, 제목, 가사와 권한 상태를 비교하고 테이블별 건수를 출력합니다. D1용 SQL 파일도 새 파일로 준비할 수 있습니다. SQL 파일에도 가사가 들어 있으므로 안전한 위치에 보관하고 Git에 올리지 마세요.

```sh
node cloudflare/tools/sqlite-to-d1.mjs '/secure/path/yebit-backup.sqlite' '/secure/path/yebit-import.sql'
```

이 SQL은 빈 데이터베이스용입니다. 실제 D1 적용 전에 별도 테스트 D1에서 검증하고 접근 제어를 구성해야 합니다.

`wrangler.test.jsonc`는 별도 테스트 DB `yebit-test`에만 연결됩니다. 원본 MySQL의 786곡, 별칭 51개, 요청 0개를 이 테스트 DB에 가져온 뒤 다시 내려받아 각 행을 원본 검증본과 비교했습니다. 운영 배포 설정으로 사용하지 마세요.

`src/worker.mjs`는 곡 목록·가사 있는 곡 목록·제목/별칭/찬송가 번호 검색용 초안입니다. Cloudflare Access 서명, 발급자, 대상 검증에 필요한 `ACCESS_TEAM_DOMAIN`과 `ACCESS_AUD`가 없으면 DB에 접근하지 않습니다. `wrangler.worker.test.jsonc`는 공개 경로와 미리보기 URL이 꺼져 있고 배포되지 않았습니다. 검색 대기열, 외부 검색, PPT 생성 및 화면은 이 Worker에 아직 연결되지 않았습니다.

```sh
node --test cloudflare/test/songs.test.mjs
npx wrangler deploy --dry-run --config cloudflare/wrangler.worker.test.jsonc
```
