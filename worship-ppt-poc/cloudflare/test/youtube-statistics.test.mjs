import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshYoutubeStatistics } from '../src/youtube-statistics.mjs';

test('batches video IDs and preserves unavailable likes as null', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ video_id: `video${index}` }));
  const writes = [];
  const db = { prepare(sql) { return {
    async all() { return { results: rows }; },
    async run() {},
    bind(...values) { return { async run() { writes.push(values); } }; },
  }; } };
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    assert.equal(url.searchParams.has('key'), false);
    const ids = url.searchParams.get('id').split(',');
    assert.ok(ids.length <= 50);
    return { ok: true, async json() { return { items: ids.map(id => ({ id, statistics: { viewCount: '42' } })) }; } };
  };
  assert.deepEqual(await refreshYoutubeStatistics(db, 'test-key', fetcher), { requested: 51, updated: 51 });
  assert.equal(calls, 2);
  assert.equal(writes[0][1], 42);
  assert.equal(writes[0][2], null);
});

test('fails clearly when no API key is configured', async () => {
  await assert.rejects(refreshYoutubeStatistics({}, ''), /not configured/);
});
