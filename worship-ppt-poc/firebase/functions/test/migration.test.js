import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRows } from '../src/migration.js';

test('한국어, 줄바꿈, 기존 권한 정보와 고유 번호를 보존한다', () => {
  const row = { id: 7, title: '독립 시험곡', lyrics: '[1절]\n첫 줄\n\n[후렴]\n둘째 줄', permission_status: 'UNKNOWN' };
  assert.deepEqual(mapRows([row]), [{ id: '7', data: row }]);
  assert.throws(() => mapRows([row, row]), /duplicate/);
});
