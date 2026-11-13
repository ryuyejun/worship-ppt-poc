import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSongVideos } from '../src/song-video-match.mjs';

test('matches a complete first song title, hides video titles and skips unrelated uploads', () => {
  const videos = [
    { videoId: 'a', videoTitle: '주의 은혜 / 주님의 사랑 | 예배 실황', views: 12, likes: 2 },
    { videoId: 'b', videoTitle: '주의 은혜로운 이야기', views: 5 },
    { videoId: 'c', videoTitle: '기도와 말씀', views: 4 },
    { videoId: 'd', videoTitle: '주의 은혜 - 다른 영상', views: 3 },
  ];
  const matches = matchSongVideos(videos, [{ title: '주의 은혜' }, { title: '주님의 사랑' }]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, '주의 은혜');
  assert.equal(matches[0].views, 12);
  assert.equal(Object.hasOwn(matches[0], 'videoTitle'), false);
});
