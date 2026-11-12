import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { listSongs, searchSongs } from '../src/songs.mjs';
import worker from '../src/worker.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0002-song-artwork-cache.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0003-external-artwork-cache.sql', import.meta.url), 'utf8'));
  const song = db.prepare('INSERT INTO songs(id,title,normalized_title,lyrics,lyrics_status,category,hymn_number) VALUES(?,?,?,?,?,?,?)');
  song.run(1, '테스트 찬양', '테스트찬양', '[1절]\n창작 문장', 'USER_SUPPLIED', 'HYMN', 123);
  song.run(2, '가사 대기', '가사대기', null, 'PENDING', null, null);
  db.prepare('INSERT INTO song_aliases(id,song_id,alias,normalized_alias) VALUES(?,?,?,?)').run(1,1,'다른 제목','다른제목');
  return { prepare(sql) { return { all: async () => ({ results: db.prepare(sql).all() }), first: async () => db.prepare(sql).get(), bind(...args) { const values = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return { all: async () => ({ results: db.prepare(sql).all(...values) }), first: async () => db.prepare(sql).get(...values), run: async () => db.prepare(sql).run(...values) }; } }; } };
}

test('D1 검색에서 한글 정규화, 별칭, 찬송가 번호와 가사 구성을 보존한다', async () => {
  const db = fixture();
  for (const title of ['테스트  찬양', '다른 제목', '123']) {
    const result = await searchSongs(db, title);
    assert.equal(result.length, 1); assert.equal(result[0].lyrics, '[1절]\n창작 문장');
  }
  assert.deepEqual(await searchSongs(db, '가사 대기'), []);
  assert.equal((await listSongs(db, false)).length, 2);
  assert.equal((await listSongs(db, true)).length, 1);
});

test('로그인 없이 검색하고 곡 ID로 저장된 가사를 읽는다', async () => {
  const env = { DB: fixture() };
  const req = (path, body) => new Request(`https://example.test${path}`, {method:'POST', body: JSON.stringify(body)});
  const search = await worker.fetch(req('/search', {title:'테스트 찬양'}), env);
  assert.equal(search.status, 200); assert.equal((await search.json()).data[0].lyrics, '[1절]\n창작 문장');
  const detail = await worker.fetch(req('/song', {id:1}), env);
  assert.equal(detail.status, 200); assert.equal((await detail.json()).data.lyrics, '[1절]\n창작 문장');
  assert.equal((await worker.fetch(req('/song', {id:2}), env)).status, 404);
});

test('익명 사용자의 데이터 수정 요청과 큰 요청은 차단한다', async () => {
  const env = { DB: fixture() };
  assert.equal((await worker.fetch(new Request('https://example.test/batch-import', {method:'POST'}), env)).status, 403);
  assert.equal((await worker.fetch(new Request('https://example.test/search', {method:'POST', body: 'x'.repeat(4097)}), env)).status, 413);
});

test('없는 곡을 반복 검색하면 대기 요청 한 건의 횟수를 늘린다', async () => {
  const env = { DB: fixture() };
  const req = title => new Request('https://example.test/search', { method: 'POST', body: JSON.stringify({title}) });
  const first = await worker.fetch(req('없는  곡'), env);
  assert.equal(first.headers.get('X-Request-Count'), '1');
  const second = await worker.fetch(req('없는 곡'), env);
  assert.equal(second.headers.get('X-Request-Count'), '2');
  const list = await worker.fetch(new Request('https://example.test/requests', {method: 'POST', body: '{}'}), env);
  const body = await list.json();
  assert.equal(body.data.length, 1); assert.equal(body.data[0].count, 2);
  assert.equal((await worker.fetch(req('테스트 찬양'), env)).headers.has('X-Request-Count'), false);
});

test('상태 확인은 DB 연결 여부만 반환한다', async () => {
  const response = await worker.fetch(new Request('https://example.test/health'), {DB: fixture()});
  assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
});

test('Pixabay 이미지를 한 번 내려받아 D1에서 재사용하고 출처를 반환한다', async () => {
  const before = globalThis.fetch; let count = 0;
  globalThis.fetch = async url => {
    count++;
    if (String(url).startsWith('https://pixabay.com/api/')) return Response.json({ hits: [{ webformatURL:'https://pixabay.com/get/photo.jpg', pageURL:'https://pixabay.com/photos/test/', user:'photographer' }] });
    const image = new Response(new Uint8Array([1,2,3]), { headers: {'content-type':'image/jpeg'} });
    Object.defineProperty(image, 'url', { value:'https://cdn.pixabay.com/test.jpg' });
    return image;
  };
  try {
    const env = { DB: fixture(), PIXABAY_API_KEY: 'test-key' };
    const req = () => new Request('https://example.test/song-artwork/search', {method:'POST',body:JSON.stringify({songId:1})});
    const first = await (await worker.fetch(req(),env)).json();
    assert.equal(first.data.available, true); assert.equal(first.data.sourceUrl, 'https://pixabay.com/photos/test/');
    const second = await (await worker.fetch(req(),env)).json();
    assert.equal(second.data.available, true); assert.equal(count, 2);
    const image = await worker.fetch(new Request('https://example.test/song-artwork/image/1'),env);
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [1,2,3]);
  } finally { globalThis.fetch=before; }
});

test('외부 곡의 사진을 별도 캐시에 저장하고 다시 조회한다', async () => {
  const before = globalThis.fetch; let count = 0;
  globalThis.fetch = async url => {
    count++;
    if (String(url).startsWith('https://pixabay.com/api/')) return Response.json({ hits: [{ webformatURL:'https://pixabay.com/get/photo.jpg', pageURL:'https://pixabay.com/photos/test/', user:'photographer' }] });
    const image = new Response(new Uint8Array([4,5,6]), { headers: {'content-type':'image/jpeg'} });
    Object.defineProperty(image, 'url', { value:'https://cdn.pixabay.com/test.jpg' });
    return image;
  };
  try {
    const env = { DB: fixture(), PIXABAY_API_KEY: 'test-key' };
    const req = () => new Request('https://example.test/song-artwork/search', {method:'POST',body:JSON.stringify({songId:-123,title:'테스트 곡'})});
    const first = await (await worker.fetch(req(),env)).json();
    assert.equal(first.data.imageUrl, '/song-artwork/image/-123');
    await worker.fetch(req(),env); assert.equal(count, 2);
    const image = await worker.fetch(new Request('https://example.test/song-artwork/image/-123'),env);
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [4,5,6]);
  } finally { globalThis.fetch=before; }
});
