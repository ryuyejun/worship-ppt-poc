# 곡 목록과 가사 일괄 가져오기

이 도구는 이 Mac의 `.server/mysql.properties`에 지정된 **MySQL**에만 연결하며, 웹사이트에서 가사를 수집하지 않습니다. 실행 전 MySQL 서버를 켜세요. 실제 가사 파일의 저장 및 사용 권한은 관리자가 확인해야 하며 `--authorized`는 사용자 선언일 뿐 프로그램이 권리나 전문 여부를 검증하지 않습니다.

## 실행 준비

```bash
cd '/path/to/worship-ppt-poc'
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
GRADLE=/tmp/gradle-8.14.3/bin/gradle
./start-mysql.sh
```

임시 Gradle 경로가 없어지면 Gradle 8.14.3 설치가 필요합니다. 서버 설정, MySQL 데이터, 권한 자료와 가사 원본은 Git에 추가하지 마세요.

## 곡 목록

`catalog/paidion-2026-metadata.json`은 공식 파이디온 페이지에서 확인한 제목·작사·작곡 및 앨범 정보만 담고 가사는 포함하지 않습니다. 제목 또는 별칭이 기존 곡과 일치하면 다른 버전 가능성을 포함해 검토 대상으로 건너뜁니다. 같은 제목의 서로 다른 곡도 자동 병합하지 않습니다.

```bash
"$GRADLE" --no-daemon batchImport '-PbatchArgs=catalog|catalog/paidion-2026-metadata.json'
```

목록 JSON의 각 항목에는 `title`, `lyricist`, `composer`, `artist`, `category`(`HYMN`/`CCM`/`UNKNOWN`), `source`(HTTP URL), `version`이 들어갑니다. 선택 항목은 `aliases` 문자열 배열, `hymn_number`, `copyright_info`입니다. 빈 출처·제목·버전은 전체 작업을 취소합니다. 기존 곡은 덮어쓰지 않습니다.

## 화면에서 가져오기

앱의 **가사 파일 일괄 가져오기**를 열고 TXT·CSV·JSON·PPTX 파일을 선택한 다음 권한 확인란을 체크하고 **파일 가져오기**를 누릅니다. 한 번에 최대 50개, 총 8MB까지 선택할 수 있습니다. 이 Mac의 로컬 서버로만 처리되며 파일 이름과 해시가 수입 이력에 기록됩니다. 선택한 파일은 처리 중 임시 복사본을 만든 뒤 삭제합니다. 등록 결과에는 성공·건너뜀 수만 보이며 상세 사유는 서버 로그에 출력됩니다. 원문·권한의 진위와 PPTX에서 추출한 내용은 사람이 확인해야 합니다.

## 가사 파일 일괄 수입

```bash
"$GRADLE" --no-daemon batchImport '-PbatchArgs=lyrics|/절대경로/허가받은가사폴더|--authorized'
```

- **TXT / PPTX:** 파일 이름에서 확장자를 뺀 부분이 DB의 제목 또는 별칭과 일치해야 합니다. 한 파일에 한 곡입니다.
- **JSON:** `[{"title":"곡 제목","lyricist":"작사자","lyrics":"[1절]\\n가사 줄"}]` 형식의 배열입니다. `lyricist`는 선택 사항입니다.
- **CSV:** UTF-8, 헤더 `title,lyricist,lyrics`를 사용합니다. `lyricist`는 선택 사항입니다. 여러 줄의 가사는 CSV 규칙에 따라 큰따옴표로 묶습니다.
- 폴더 바로 아래 파일만 읽습니다. 제목이 없거나 검색 결과가 0개 또는 2개 이상인 경우, 혹은 기존 가사가 있으면 건너뜁니다. 같은 파일을 다시 실행해도 기존 가사를 덮어쓰지 않습니다.
- TXT·JSON·CSV는 원문 줄바꿈을 유지합니다. PPTX는 슬라이드 순서와 텍스트 도형을 읽어 슬라이드마다 구간을 나눕니다. 그림 속 글자, 도형 그룹, 애니메이션 순서나 가사 외 텍스트는 정확하게 처리하지 못할 수 있어 **수입 후 원본과 대조가 필요합니다.**
- 가져온 가사에는 `UNKNOWN` 권한 상태를 유지합니다. `lyric_import_audit`에 파일명, 가사 해시, 수입 시간과 검토 필요 상태를 기록합니다. 기존 앱 설정에 따라 가사가 저장되면 권한 미확인이라도 PPT가 생성될 수 있으므로 사용 전 권리를 확인하세요.
