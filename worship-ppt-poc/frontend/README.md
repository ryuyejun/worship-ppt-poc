# React 제작 화면

화면은 React, TypeScript, Vite로 작성하며, 배포 시 `gradle bootJar`가 빌드한 정적 파일을 Spring Boot 앱에 포함합니다. 브라우저는 현재 페이지의 Java API를 호출합니다.

개발 서버로 화면만 실행하려면 Spring Boot를 8080 포트에 먼저 실행한 뒤 다음 명령을 사용합니다.

```sh
npm install
VITE_API_TARGET=http://127.0.0.1:8080 npm run dev
```

프로젝트 기본 로컬 실행은 기존처럼 `찬양 PPT 만들기.app` 또는 `./gradlew localWeb`을 사용합니다. 기본 실행에서 표시되는 주소는 백엔드가 실제로 연 주소입니다.

## PPT 슬라이드 악보

PPT 편집 화면 오른쪽의 **악보** 영역에서 현재 제작 곡 제목의 MIDI를 자동 검색합니다. MIDI를 찾으면 높은음자리표 악보를 만들어 현재 슬라이드 미리보기와 PPTX에 바로 넣습니다. 검색 결과가 없으면 `.mid` / `.midi` 파일 또는 음원 파일을 같은 영역에서 불러오세요. 음원은 Basic Pitch로 분석해 현재 PPT에 바로 반영합니다.

MIDI 트랙이 여러 개면 트랙 선택 메뉴에서 바꿀 수 있습니다. 제목 검색 카탈로그는 현재 CCEL 공개 찬송가 3곡이며, 로컬 Vite에서 검색하려면 `VITE_MIDI_API_TARGET`을 개발 Worker 주소로 지정합니다. 별도 악보 미리보기 시험 화면은 개발용 `?score` 경로로 유지합니다.
