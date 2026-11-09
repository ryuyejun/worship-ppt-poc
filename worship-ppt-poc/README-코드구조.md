# 코드 구조와 역할

## 공통 설정

- `MySqlStore`: 이전 명령행·이전 도구와 SQLite 회귀 테스트를 위한 JDBC 호환 코드. 일반 MySQL 웹 요청에서는 사용하지 않음.
- `DatabaseLocation`: MySQL 설정이 없을 때 사용할 SQLite 경로를 설정값에서 읽음.
- `SongJpaConfig`: 앱의 JPA와 JDBC가 같은 DB를 사용하도록 연결.
- `LocalAccessFilter`: 로컬 토큰과 요청 크기 확인.
- `LocalAccessToken`: 실행 중인 앱의 로컬 요청 확인 값 생성.
- `LocalSecurityConfig`: 로컬 화면에 맞는 Spring Security 필터 설정.
- `ApiErrors`: 오류를 공통 응답으로 변환.
- `ApiResponse`: JSON 응답 형식.
- `LocalWeb`: Spring Boot 실행 및 브라우저 열기.

## 곡과 대기열

- `Song`: DB의 곡 엔티티.
- `SongController`: 곡 검색, 목록, 대기열 요청의 HTTP 처리.
- `SongService`: 곡과 대기열 기능 연결.
- `SongRepository`: JPA로 곡 목록과 곡 ID 조회.
- `SongListProjection`: 목록에 필요한 열만 읽는 JPA 조회 형식.
- `SongOperationsRepository`: JPA 검색·대기열 트랜잭션. 최초 동시 요청의 중복 방지는 원자적인 네이티브 갱신 사용.
- `SongStore`: 기존 곡 검색, 가사 저장과 SQLite/MySQL 연결 기능.
- `SongRequests`: 미등록 곡 대기열과 요청 횟수 관리.
- `CompleteRequest`, `QueueSearchRequest`, `SearchSongRequest`: 각각 대기열 완료, 대기열 검색, 곡 검색 입력값.
- `SongListResponse`, `SongResponse`, `SongSearchResult`: 곡 목록, 검색 결과, 검색 결과와 요청 횟수 전달.

## 가사 가져오기

- `ImportController`: 파일 가져오기 HTTP 요청 처리.
- `LyricsImportService`: 파일 이름·크기 확인과 임시 파일 관리.
- `LyricsImportRepository`: JPA 곡 잠금·가사 저장·감사 기록을 하나의 트랜잭션에서 처리.
- `BatchImport`: 파일 파싱, 곡 대조와 가져오기 흐름.
- `BatchImportDatabase`: 가져오기 기록, 기존 가사 잠금 및 카탈로그 DB 작업.
- `FileEntry`, `LyricsImportRequest`, `LyricsImportResponse`: 업로드 파일, 요청과 결과 전달.
- `src/tools/java`의 `HymnImport`, `HymnLyricsImport`: 관리자가 수동 실행하는 bible.db 이전 도구. 앱 JAR에는 포함하지 않음.

## PPT와 화면

- `PptController`: PPT 다운로드 요청 처리.
- `PptService`: 곡 선택과 업로드 PPT 검증, PPT 생성 연결.
- `PptBatch`: 여러 곡을 순서대로 PPT에 추가.
- `PptSample`: 실제 PPT 슬라이드 작성 기능도 제공하는 기존 생성기.
- `PptBatchRequest`, `SongIdRequest`: 여러 곡 또는 단일 곡 PPT 요청값.
- `PageController`, `PageService`: 로컬 웹 화면과 로고 제공.
- `frontend/src`: React·TypeScript 기반 PPT 제작 및 곡 관리 화면.
- `frontendBuild`: Vite 화면을 만들고 Spring Boot 정적 리소스로 포함.

## 카탈로그 관리 도구

- `YouthCatalog`: 카탈로그 일괄 등록 도구 실행점과 DB 마이그레이션.
- `CatalogJpaConfig`: 카탈로그 도구 전용 JPA 연결.
- `YouthCatalogService`: 확인한 목록과 출처를 대조해 등록.
- `CatalogEntry`, `CatalogEvidence`: 카탈로그 우선순위와 출처 엔티티.
- `SongAlias`: 단일 자동 증가 ID를 가진 별칭 엔티티. 곡과 별칭의 기존 복합 UNIQUE는 유지.
- `CatalogEntryRepository`, `CatalogEvidenceRepository`, `SongAliasRepository`: 각 카탈로그 데이터의 JPA 접근.

## DB 설정과 라즈베리파이

MySQL을 사용하려면 실행 시 `worship.mysql.config`에 해당 서버에서 접근 가능한 설정 파일 경로를 지정한다. 설정 파일에는 MySQL URL, 사용자, 비밀번호가 들어가며 컴퓨터마다 경로와 접속 주소를 다르게 설정할 수 있다. `DatabaseLocation`의 기본 상대 경로는 MySQL 설정이 없을 때 사용하는 SQLite용이다.

현재 웹 서버는 `127.0.0.1`에만 바인딩하고 로컬 토큰을 사용한다. 따라서 라즈베리파이에 그대로 올려도 다른 컴퓨터에서 접근하는 공유 서비스가 되는 것은 아니다. 네트워크 바인딩과 사용자 인증·접근 제어를 별도로 구성해야 한다.

## JPA 전환과 기존 DB

웹의 곡 조회·검색·대기열·가사 가져오기, 카탈로그 등록은 JPA를 사용한다. MySQL 웹 연결은 Spring DataSource를 사용하며 spring.datasource.url/username/password 또는 기존 worship.mysql.config 파일을 지원한다. SchemaMigration은 Flyway로 단일 별칭 ID 추가를 한 번 적용한다. 기존 곡 786건과 별칭 51건의 값은 변경 전후 비교로 보존을 확인했다. 제작 화면은 `/ppt-songs`의 가사 등록 목록과 가사 저장 여부를 검사하는 `/search`만 사용하고, 관리 화면에서만 기존 전체 `/songs` 목록을 보여준다.

JPA는 테이블 변경과 외부 SQLite 파일 읽기를 대신하지 않는다. 이전 CLI 도구의 JDBC와 스키마 마이그레이션 SQL은 남아 있다. 최초 동시 검색에서 요청 횟수를 정확히 올리는 네이티브 upsert 한 곳도 의도적으로 유지한다.
