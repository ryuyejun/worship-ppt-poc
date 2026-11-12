import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSongTitle, toSong } from '../src/services/firestore-songs';

test('한글 유니코드와 공백, 대소문자 정규화', () => {
  assert.equal(normalizeSongTitle(' 소중해   LOVE '), normalizeSongTitle('소중해 love'));
});

test('기존 곡 정보와 가사 줄바꿈을 보존한다', () => {
  const actual = toSong({ id: 7, title: '테스트곡', lyricist: '테스트', lyrics_status: 'USER_SUPPLIED', lyrics: '[1절]\n첫 줄\n\n[후렴]\n둘째 줄' });
  assert.equal(actual.id, 7);
  assert.equal(actual.author, '테스트');
  assert.equal(actual.lyrics, '[1절]\n첫 줄\n\n[후렴]\n둘째 줄');
});
