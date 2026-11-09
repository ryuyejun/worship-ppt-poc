# 단일 곡 로컬 SQLite 실험

Java 21, Gradle 8.14.3을 사용합니다. 최초 실행에는 Maven Central에서 SQLite JDBC 및 Apache POI 의존성을 다운로드할 네트워크 연결이 필요합니다. 기존 `PptSample.writeSlides`를 그대로 이용하며 Spring Boot 없이 로컬 웹 화면을 제공합니다.

실험 기록의 실행 경로(이 컴퓨터에서 확인됨):

```bash
cd '/path/to/worship-ppt-poc'
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
GRADLE=/tmp/gradle-8.14.3/bin/gradle
"$GRADLE" --no-daemon localSong '-PsongArgs=init|local-songs.sqlite3'
"$GRADLE" --no-daemon localSong '-PsongArgs=search|local-songs.sqlite3|소중해 존귀해 보배로워|송예운'
"$GRADLE" --no-daemon localSongCheck
```

`/tmp`의 Gradle은 임시 파일이므로 없어지면 Gradle 8.14.3을 별도로 설치하고 `GRADLE=gradle`로 바꾸세요. 프로젝트에 Gradle wrapper는 없습니다. `init`은 동일 출처 URL과 버전이면 중복 등록하거나 기존 가사를 덮어쓰지 않습니다. DB는 `local-songs.sqlite3`이며 git ignore 됩니다.

ID 1의 실제 곡에는 파이디온 공식 페이지에서 확인한 가사가 보존되어 있습니다. 사용자의 정정에 따라 허가 상태는 `UNKNOWN`이며, `USER_SUPPLIED`는 유입 경로나 허가의 확인을 의미하지 않습니다. `USER_SUPPLIED`는 사용자가 권한 확인을 선언하고 텍스트를 수입했다는 뜻이며, 프로그램이 저작권·허가·가사 완전성을 검증했다는 뜻이 아닙니다. 허가가 확인된 UTF-8 파일을 직접 준비한 뒤, 현재 검색 결과의 ID를 확인하고 실행하세요(기존 가사는 대체됩니다).

```bash
"$GRADLE" --no-daemon localSong '-PsongArgs=import|local-songs.sqlite3|1|/절대경로/허가받은가사.txt|--authorized'
"$GRADLE" --no-daemon localSong '-PsongArgs=ppt|local-songs.sqlite3|1|/절대경로/결과.pptx'
```

`--authorized`는 로컬 저장과 PPT 사용 모두에 대한 사용자 확인 선언입니다. 가사 수입만으로 허가 상태가 검증되지는 않지만, 저장된 가사는 PPT로 생성할 수 있습니다. 새로 가사를 수입하면 이전 검증 상태도 `UNKNOWN`으로 돌아갑니다. 실제 권한과 저작권 표기를 따로 확인하세요. PPT 출력은 기존 파일을 덮어쓰지 않습니다. 가사 원문은 줄바꿈을 포함하여 저장하며 `[1절]`, `[후렴]`처럼 한 줄 전체를 차지하는 대괄호 레이블 및 빈 줄을 슬라이드 구간의 경계로 인식합니다. 레이블 자체는 PPT에 표시하지 않습니다. 그 외 특별한 가사 표기법은 별도 지원하지 않습니다.

`localSongCheck`는 임시 DB에 대상 메타데이터와 별도 **창작 테스트 문장**을 넣고 재열기, 한글 정규화, 중복 차단, 가사 미입력 PPT 차단, 파일 수입과 PPT 텍스트 일치를 검사합니다. 실제 곡 가사나 실제 곡 PPT를 생성하지 않습니다. 테스트의 임시 파일 경로는 실행 결과에 표시됩니다.


## 메타데이터와 직접 제공 가사

웹에서 수동 확인한 제목, 작사자, 작곡자, 가수, 원본 URL, 버전을 아래 순서로 등록할 수 있습니다. 이는 웹 자동 검색이나 가사 자동 추출이 아닙니다. 빈 크레딧은 `미확인`으로 저장하고 가사 상태는 `PENDING`입니다. 같은 출처 URL과 버전은 추가하지 않습니다.

```bash
"$GRADLE" --no-daemon localSong '-PsongArgs=register|local-songs.sqlite3|곡 제목|작사자|작곡자|가수|https://example.org/song|버전'
```

직접 제공받은 가사를 표준 입력으로도 수입할 수 있습니다. 끝나면 macOS 터미널에서 Ctrl+D를 눌러 입력을 종료하세요. ID는 검색 결과에서 확인해야 하며, 이 작업은 해당 곡의 기존 가사를 덮어씁니다.

```bash
"$GRADLE" --no-daemon localSong '-PsongArgs=import-text|local-songs.sqlite3|곡ID|--authorized'
```

현재 브라우저 화면에는 메타데이터 수동 등록이나 텍스트 입력 기능이 없으며, 위 명령은 별도 로컬 관리 기능입니다. `USER_SUPPLIED` 표시만으로 권리나 완전성이 검증되지는 않습니다.


## 추가할 곡 대기열

로컬 웹 화면과 `search` 명령은 DB에서 곡을 찾지 못하면 대기열에 저장합니다. 제목과 작사자를 NFC·공백·대소문자로 정규화하고, 작사자를 모르는 요청은 빈 작사자로 별도 관리합니다. 같은 요청은 횟수가 증가하고, 알려진 작사자가 다르면 별개의 요청입니다. 웹 화면에서 제목이나 작사자로 대기열을 검색하고 곡 ID를 입력하여 수동 완료할 수 있습니다. `register`로 곡을 등록하면 작사자가 일치하는 요청을 자동 완료하며, 작사자 미상 요청은 제목이 유일할 때만 자동 완료합니다.

기존 가사가 있는 곡은 허가 상태와 관계없이 PPT를 생성할 수 있습니다. `UNKNOWN`은 계속 미확인으로 기록됩니다. 관리자가 실제 허가 근거를 검토한 뒤에만 다음 명령으로 근거를 저장해 상태를 바꿀 수 있습니다. 이 명령 자체가 권한의 진위를 자동 검증하지는 않습니다.

```bash
"$GRADLE" --no-daemon localSong '-PsongArgs=permission-verify|local-songs.sqlite3|곡ID|검토한 허가 증빙과 범위'
```
