# 찬양 PPT 실행 패키지

Java 21과 접근 가능한 기존 MySQL이 필요합니다. 코드는 `org.localchurch.worship` 패키지를 사용합니다. 이는 임시 이름이며 실제 운영 도메인이 생기면 변경할 수 있습니다.

## 실행

배포 ZIP을 풀고 Java 시스템 속성 `worship.mysql.config`에 MySQL JDBC 설정 파일의 절대 경로를 지정합니다. 설정 파일의 형식은 다음과 같습니다. 비밀번호와 이 파일은 ZIP이나 Git에 포함하지 않습니다.

```properties
url=jdbc:mysql://127.0.0.1:13306/worship_local?useUnicode=true&characterEncoding=UTF-8&connectionTimeZone=UTC
user=your_user
password=your_password
```

Mac/Linux에서 ZIP을 푼 뒤:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)  # macOS
export JAVA_OPTS="-Dworship.mysql.config=/absolute/path/mysql.properties"
./bin/worship-ppt-poc
```

시작 로그의 `http://127.0.0.1:포트/`를 브라우저에서 엽니다. 기존 로컬 Mac 앱은 별도로 기존 `.server/mysql.properties`를 사용합니다. 데이터베이스 및 가사는 ZIP에 포함되지 않습니다.

화면은 `frontend/`의 React + TypeScript + Vite 코드에서 빌드되어 Spring Boot JAR에 포함됩니다. 소스를 다시 빌드할 때만 Node.js와 npm이 필요하며 실행 컴퓨터에는 Java 21과 MySQL이 필요합니다. 제작 화면의 `/ppt-songs`와 `/search`는 가사가 실제 저장된 곡만 반환하고, 관리 화면의 `/songs`는 기존 전체 목록을 유지합니다.

## PPT 생성 API (현재 로컬 앱용)

`POST /ppt/batch`, Content-Type `application/json`, `X-Local-Token: <실행 중인 화면의 토큰>`. 화면을 제공하는 GET `/`의 스크립트에 같은 토큰이 들어 있습니다. 이는 현재 브라우저용 로컬 세션 보호 방식이며 공개 서비스용 인증이 아닙니다.

```json
{"songIds":[160,161],"pptxBase64":"선택사항: 기존 PPTX의 Base64"}
```

요청 배열 순서대로 기존 PPTX 마지막에 추가하고, 파일이 없으면 새 PPTX를 반환합니다. 곡은 1~100개, 기존 PPTX는 최대 20MB입니다. 가사가 없거나 파일이 잘못되면 400 응답입니다. 성공 시 PPTX 바이너리를 반환합니다. 원본 파일은 수정하지 않습니다. 기존 `/ppt` 단일 곡 API도 유지합니다.

서버는 현재 127.0.0.1의 임의 포트에서만 실행됩니다. 외부에 그대로 공개할 수 있는 형태가 아닙니다. 서버 배포 전 별도의 사용자 인증, 권한, HTTPS, 파일 처리 및 운영 설정을 구현하고 점검해야 합니다. 곡 콘텐츠와 프레젠테이션은 저작권 및 실제 허가 범위에 맞게 사용하세요.

## 검증

프로젝트에서 `gradle pptBatchCheck localSongCheck`를 실행합니다. 처음은 창작 테스트 문장과 임시 SQLite를 사용해 기존 PPT의 내용·화면비·곡 순서를 검증합니다.

## 코드 구조

Java 코드는 `src/main/java/org/localchurch/worship/` 아래에서 계층과 기능별로 나뉩니다.

- `song`: 곡 검색과 요청 관리, 하위에 `controller`, `service`, `repository`, `dto`
- `ppt`: PPT 생성과 관련 `controller`, `service`, `dto`
- `importer`: 가사 가져오기와 관련 `controller`, `service`, `repository`, `dto`
- `page`: 화면 제공을 위한 `controller`, `service`
- `global/config/localaccess`, `global/config/database`: 공통 로컬 접근 및 DB 설정
- `dto/request`, `dto/response`: 요청·응답 데이터와 유효성 검증
- `global/exception`, `global/response`: 공통 오류 처리와 JSON 응답 형식
- `song`: 기존 곡 관리와 요청 대기열 로직
- `ppt`: Apache POI 기반 PPT 생성
- `database`: MySQL 연결과 데이터 이전
- `importer`: 파일·찬송가 가져오기
- `catalog`, `provider`: 곡 목록과 자료원 실험
- `web`: Spring Boot 시작점

곡 조회·검색·요청 대기열·가사 가져오기와 카탈로그 등록은 JPA 리포지토리를 사용합니다. MySQL 웹 연결은 Spring DataSource가 담당하며 스키마 변경은 Flyway가 관리합니다. 테스트 소스는 `src/test/java`에 있습니다. 화면과 로고는 `src/main/resources`에 있습니다.

`bible.db` 전용 찬송가 일괄 이전 도구는 `src/tools/java`에 있으며 앱 JAR에 포함되지 않습니다. 개발 환경에서 기존 Gradle 작업 `hymnImport`, `hymnLyricsImport`로 실행할 수 있습니다. 일반 화면의 가사 파일 가져오기는 앱에 유지합니다.

## Spring Boot 전환

웹 서버는 Java 21과 Spring Boot 4.0.8을 사용합니다. `web` 패키지의 `LocalWeb`이 시작점이며, 기능별 패키지 안의 컨트롤러가 화면의 API를 처리합니다. MySQL 접속 설정을 유지합니다. JSON API 응답은 `success`, `data`, `error` 필드로 구성되며 PPT 다운로드는 파일 응답입니다.

실행 가능한 Spring Boot JAR은 `build/libs/worship-ppt-poc-0.0.1-SNAPSHOT.jar`입니다. 예를 들어 프로젝트 폴더에서:

```bash
java -Dworship.mysql.config="$PWD/.server/mysql.properties" -jar build/libs/worship-ppt-poc-0.0.1-SNAPSHOT.jar
```

기본 주소는 127.0.0.1이고 포트는 실행할 때 자동 배정됩니다. 로그의 `로컬 화면` 주소로 접속하세요. 기본 로컬 토큰은 사용자 인증 기능이 아니므로 라즈베리파이에서 다른 기기나 인터넷에 공개하기 전에는 인증·접근 제어·HTTPS 등 운영 구성을 별도로 해야 합니다. 테스트에는 `gradle test pptBatchCheck localSongCheck songRequestsCheck`를 사용합니다.

요청된 JPA, Redis, Mail, JWT, Security 라이브러리는 빌드에 포함되어 있지만 해당 서비스나 로그인은 구현되지 않았습니다. 현재 로컬 접속 동작을 유지하기 위해 JPA 데이터소스 자동 구성은 비활성화하고 기존 JDBC를 사용하며, Spring Security 설정은 로컬 토큰 필터와 함께 동작합니다. 외부 공개를 위한 인증 기능은 별도로 필요합니다.
