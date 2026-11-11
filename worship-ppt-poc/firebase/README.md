# Firebase 전환 준비

기존 Spring 앱과 분리된 실험 코드입니다. 실제 Firebase 프로젝트나 데이터를 자동으로 만들거나 배포하지 않습니다.

- `functions/src/ppt.js`: 테스트 문장으로 검증한 새 PPTX 생성 실험
- `functions/src/migration.js`: 기존 행의 ID와 가사를 보존하는 변환 함수
- `functions/index.js`: Firebase 인증을 요구하는 Firestore 기반 PPT 생성 초안
- `firestore.rules`: 클라이언트 직접 접근을 기본 차단하는 초안. 관리자 SDK는 규칙을 우회하므로 서버에서 별도 권한 검증이 필요합니다.

`npm ci --prefix functions && npm test --prefix functions`로 시험합니다. Node 22가 Firebase 배포 대상입니다.

아직 프론트엔드 연결, MySQL 데이터 가져오기, 사용자별 접근 권한, 가사 검색, 기존 PPTX에 추가, 이미지 배경, 정확한 슬라이드 미리보기와 배포 검증은 구현되지 않았습니다. 함수는 인증만 확인하고 사용자별 역할을 확인하지 않으므로 배포하거나 실제 데이터에 연결하면 안 됩니다. MySQL 데이터는 변경하지 않았습니다.

현재 `pptxgenjs`의 간접 의존성 `image-size`에 높은 심각도의 npm 보안 경고가 있습니다. 사용자 파일 처리와 배포 전에 해결하고 재검증해야 합니다.
