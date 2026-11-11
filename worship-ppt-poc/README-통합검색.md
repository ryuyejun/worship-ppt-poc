# 통합 검색

곡 찾기에서 LRCLIB를 먼저 조회합니다. 가사가 없거나 연결이 실패하면 Musixmatch 및 Spotify의 곡 정보를 확인한 후 기존 DB를 검색합니다. 추가 제공처의 곡 정보는 가사가 아니며 PPT 제작에 사용할 수 없습니다. LRCLIB는 작사가를 반환하지 않으므로 선택 전에 가수와 가사를 확인해야 합니다.

API 인증 정보는 Git에 저장하지 않고 서버 실행 환경에 설정합니다.

- `MUSIXMATCH_API_KEY`: Musixmatch 공식 API 키
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`: Spotify 앱 인증 정보

키가 없으면 해당 제공처를 건너뜁니다. Musixmatch 가사 전문 및 PPT 활용은 계약 조건 확인이 필요하여 현재는 곡 정보 검색만 연결합니다. Spotify의 공식 곡 검색은 가사를 반환하지 않습니다.
