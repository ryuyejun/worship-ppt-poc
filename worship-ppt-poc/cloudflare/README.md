# Cloudflare 전환 준비

이 폴더는 기존 MySQL 데이터를 D1으로 이전하기 위한 준비 단계입니다. D1 업로드, Worker API, 인증, PPT 생성 전환 및 배포는 아직 구현되지 않았습니다.

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
