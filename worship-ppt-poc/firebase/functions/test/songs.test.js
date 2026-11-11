import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle } from '../src/songs.js';

test('한글 Unicode, 공백과 영문 대소문자를 정리한다', () => {
  assert.equal(normalizeTitle(' 소중해   LOVE '), normalizeTitle('소중해 love'));
});
