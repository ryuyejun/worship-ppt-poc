import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { listSongs, searchSongs } from '../src/songs.mjs';
import worker from '../src/worker.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const song = db.prepare('INSERT INTO songs(id,title,normalized_title,lyrics,lyrics_status,category,hymn_number) VALUES(?,?,?,?,?,?,?)');
  song.run(1, '테스트 찬양', '테스트찬양', '[1절]\n창작 문장', 'USER_SUPPLIED', 'HYMN', 123);
  song.run(2, '가사 대기', '가사대기', null, 'PENDING', null, null);
  db.prepare('INSERT INTO song_aliases(id,song_id,alias,normalized_alias) VALUES(?,?,?,?)').run(1,1,'다른 제목','다른제목');
  return { prepare(sql) { return { all: async () => ({ results: db.prepare(sql).all() }), bind(...args) { return { all: async () => ({ results: db.prepare(sql).all(...args) }) }; } }; } };
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

test('Cloudflare Access 인증이 없으면 데이터베이스를 읽지 않는다', async () => {
  const db = { prepare() { throw new Error('unauthorized database read'); } };
  const response = await worker.fetch(new Request('https://example.test/search', { method: 'POST', body: '{"title":"테스트"}' }), { DB: db });
  assert.equal(response.status, 401);
});

test('서명·발급자·대상이 올바른 Access 토큰으로만 곡을 반환한다', async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://test-team.cloudflareaccess.com/cdn-cgi/access/certs');
    return Response.json({ keys: [publicJwk] });
  };
  try {
    const aud = 'a'.repeat(64);
    const issue = audience => new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://test-team.cloudflareaccess.com').setAudience(audience).setExpirationTime('5m').sign(privateKey);
    const request = token => new Request('https://example.test/search', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token }, body: JSON.stringify({ title: '테스트 찬양' }) });
    const env = { DB: fixture(), ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', ACCESS_AUD: aud };
    const success = await worker.fetch(request(await issue(aud)), env);
    assert.equal(success.status, 200);
    assert.equal((await success.json()).data[0].lyrics, '[1절]\n창작 문장');
    const wrongAudience = await worker.fetch(request(await issue('b'.repeat(64))), env);
    assert.equal(wrongAudience.status, 401);
  } finally { globalThis.fetch = originalFetch; }
});
