# Yebit

찬양 가사를 검색하고 PPTX를 만드는 웹 앱입니다. 프론트엔드는 React·TypeScript·CSS, 서버는 Cloudflare Workers, 데이터베이스는 Cloudflare D1을 사용합니다. PPTX는 브라우저에서 JavaScript로 생성합니다.

## 실행 및 검사

Node.js 22 이상을 사용합니다.

```sh
npm install --prefix frontend
npm --prefix frontend run build
npm --prefix frontend test
node --test cloudflare/test/songs.test.mjs
npx wrangler dev --config cloudflare/wrangler.web.test.jsonc
```

Wrangler 개발 서버는 빌드된 화면을 제공합니다. 원격 D1과 연결하려면 Cloudflare 인증이 필요합니다. 설정은 테스트 데이터베이스 `yebit-test`를 사용합니다.

## 현재 범위

곡 검색, 가사 조회, 여러 곡의 PPTX 생성 및 브라우저 미리보기를 제공합니다. 기존 PPTX에 슬라이드를 추가하는 기능은 전환 중이므로 아직 사용할 수 없습니다. 미리보기는 브라우저에서 그린 결과로 PowerPoint의 글꼴과 줄바꿈이 완전히 같지 않을 수 있습니다. 로그인 없는 공개 앱이므로 곡 일괄 등록과 요청 완료 등 데이터 변경 기능은 차단되어 있습니다.

Pixabay 검색은 Workers의 `PIXABAY_API_KEY` 비밀 변수를 사용합니다. Pixabay 사진은 곡의 실제 앨범 표지가 아닙니다. 자세한 구성은 [cloudflare/README.md](cloudflare/README.md)를 참고하세요.
