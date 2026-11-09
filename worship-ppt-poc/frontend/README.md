# React 제작 화면

화면은 React, TypeScript, Vite로 작성하며, 배포 시 `gradle bootJar`가 빌드한 정적 파일을 Spring Boot 앱에 포함합니다. 브라우저는 현재 페이지의 Java API를 호출합니다.

개발 서버로 화면만 실행하려면 Spring Boot를 8080 포트에 먼저 실행한 뒤 다음 명령을 사용합니다.

```sh
npm install
VITE_API_TARGET=http://127.0.0.1:8080 npm run dev
```

프로젝트 기본 로컬 실행은 기존처럼 `찬양 PPT 만들기.app` 또는 `./gradlew localWeb`을 사용합니다. 기본 실행에서 표시되는 주소는 백엔드가 실제로 연 주소입니다.
