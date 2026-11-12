# Firebase 전환 준비

기존 Spring 앱과 분리된 실험 코드입니다. 실제 Firebase 프로젝트나 데이터를 자동으로 만들거나 배포하지 않습니다.

- `functions/src/ppt.js`: 테스트 문장으로 검증한 새 PPTX 생성 실험
- `functions/src/migration.js`: 기존 행의 ID와 가사를 보존하는 변환 함수
- `functions/index.js`: Firebase 인증을 요구하는 Firestore 기반 PPT 생성 초안
- `firestore.rules`: 클라이언트 직접 접근을 기본 차단하는 초안. 관리자 SDK는 규칙을 우회하므로 서버에서 별도 권한 검증이 필요합니다.

`npm ci --prefix functions && npm test --prefix functions`로 시험합니다. Node 22가 Firebase 배포 대상입니다.

아직 프론트엔드 연결, 실서비스 MySQL 데이터 이전, 사용자별 접근 권한, 기존 PPTX에 추가, 이미지 배경, 정확한 슬라이드 미리보기와 배포 검증은 구현되지 않았습니다. 함수는 인증만 확인하고 사용자별 역할을 확인하지 않으므로 배포하거나 실제 데이터에 연결하면 안 됩니다. MySQL 데이터는 변경하지 않았습니다.

현재 `pptxgenjs`의 간접 의존성 `image-size`에 높은 심각도의 npm 보안 경고가 있습니다. 사용자 파일 처리와 배포 전에 해결하고 재검증해야 합니다.

로컬 에뮬레이터에서 기존 MySQL 786곡과 별칭 51개를 복사하고 가사 646건, 제목 및 기존 권한 상태가 일치하는지 검증했습니다. 기존 MySQL은 읽기 전용이며 실제 Firebase에는 연결하지 않았습니다. 에뮬레이터는 종료 시 데이터가 삭제됩니다.

```sh
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
npx firebase-tools emulators:exec --only firestore --project demo-worship 'GCLOUD_PROJECT=demo-worship node functions/src/import-emulator.js "/path/to/mysql.properties" && GCLOUD_PROJECT=demo-worship node functions/src/verify-emulator.js'
```

가져오기 도구는 로컬 MySQL과 `demo-` 프로젝트의 로컬 에뮬레이터만 허용하며 기존 Firestore 문서를 덮어쓰지 않습니다. 여러 배치 중 하나가 실패하면 이전 배치가 남을 수 있으므로 깨끗한 에뮬레이터에서 시험해야 합니다.

## Yebit 프로젝트 연결

Firebase 콘솔의 `yebit-39286` 프로젝트에 `Yebit` 웹 앱과 서울 리전 Firestore가 생성되어 있습니다. Spark 무료 요금제이며 Firestore 클라이언트 접근은 기본적으로 차단되어 있습니다. React 앱은 `frontend/.env.local`의 Vite 설정으로 Firebase SDK를 초기화합니다. 설정 파일은 Git에 추가하지 않습니다.

주의: SDK 초기화는 기존 기능의 Firestore 전환을 뜻하지 않습니다. 현재 화면의 곡 검색 및 PPT 생성은 기존 Spring 서버를 사용합니다. 실데이터는 Firestore에 이전하지 않았으며 인증과 보안 규칙 설계가 필요합니다. Spark 요금제에서는 Cloud Functions를 배포할 수 없으므로 기존 Functions 초안을 배포하지 마세요.
