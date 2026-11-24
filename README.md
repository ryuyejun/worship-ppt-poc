# Yebit

찬양 곡을 검색하고 예배용 PPT를 만드는 웹 앱입니다.

## 프로젝트 구성

- `frontend/`: React 웹 화면과 Vercel 배포 설정
- `cloudflare/`: Cloudflare Worker API, D1 마이그레이션과 데이터 도구
- `lyrics-api/`: 가사 추출 기능
- `melody-api/`: 악보 이미지 검색과 음표 처리 기능
- `catalog/`: 곡 검색에 사용하는 카탈로그와 후보 자료

## 브랜치

- `main`: 배포 버전
- `develop`: 다음 변경을 모으는 개발 버전
