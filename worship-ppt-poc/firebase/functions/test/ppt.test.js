import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createPpt, splitLyrics } from '../src/ppt.js';

test('절과 빈 줄을 구분하고 지정한 줄 수로 나눈다', () => {
  assert.deepEqual(splitLyrics('[1절]\n첫 테스트 줄\n둘째 테스트 줄\n셋째 테스트 줄\n\n[후렴]\n넷째 테스트 줄', 2),
    [['첫 테스트 줄', '둘째 테스트 줄'], ['셋째 테스트 줄'], ['넷째 테스트 줄']]);
  assert.throws(() => splitLyrics('', 2));
});

test('여러 곡과 스타일을 실제 PPTX에 순서대로 저장한다', async () => {
  const data = await createPpt([{ lyrics: '첫 번째 시험 문장' }, { lyrics: '두 번째 시험 문장' }], { backgroundColor: '#aabbcc', textColor: '#112233', fontSize: 32 });
  const zip = await JSZip.loadAsync(data);
  const slide1 = await zip.file('ppt/slides/slide1.xml').async('string');
  const slide2 = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(slide1, /첫 번째 시험 문장/);
  assert.match(slide2, /두 번째 시험 문장/);
  assert.match(slide1, /AABBCC/i);
});
