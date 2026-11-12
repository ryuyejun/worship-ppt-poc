# 통합 검색

곡 찾기에서 LRCLIB를 먼저 조회합니다. 가사가 없거나 연결이 실패하면 Musixmatch 및 Spotify의 곡 정보를 확인한 후 기존 DB를 검색합니다. 추가 제공처의 곡 정보는 가사가 아니며 PPT 제작에 사용할 수 없습니다. LRCLIB는 작사가를 반환하지 않으므로 선택 전에 가수와 가사를 확인해야 합니다.

API 인증 정보는 Git에 저장하지 않고 서버 실행 환경에 설정합니다.

- `MUSIXMATCH_API_KEY`: Musixmatch 공식 API 키
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`: Spotify 앱 인증 정보
- `PIXABAY_API_KEY`: Pixabay 이미지 API 키. API 키는 브라우저에 노출하지 않고 백엔드에서만 사용합니다.

키가 없으면 해당 제공처를 건너뜁니다. Musixmatch 가사 전문 및 PPT 활용은 계약 조건 확인이 필요하여 현재는 곡 정보 검색만 연결합니다. Spotify의 공식 곡 검색은 가사를 반환하지 않습니다.

곡을 최근 선택하면 Pixabay에서 제목을 검색해 사진을 내려받고, 최근 카드에서 Pixabay 원본 페이지와 기여자를 연결합니다. API 응답은 24시간 캐시하며, 이미지는 임시 URL에 영구 연결하지 않고 서버의 `~/.yebit/artwork`에 저장합니다. 저장 경로는 `YEBIT_ARTWORK_DIRECTORY` 환경 변수로 변경할 수 있습니다. Pixabay 사진은 앨범 표지나 곡 공식 이미지가 아니라 검색어와 관련된 스톡 사진입니다.
