import { createRemoteJWKSet, jwtVerify } from 'jose';
import { listSongs, searchSongs } from './songs.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status) => json({ success: false, data: null, error: message }, status);
let keySet;
let keyIssuer;

async function authenticate(request, env) {
  const domain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(domain || '') || !/^[a-f0-9]{64}$/i.test(audience || '')) return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  const issuer = `https://${domain}`;
  if (issuer !== keyIssuer) { keySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); keyIssuer = issuer; }
  try { await jwtVerify(token, keySet, { issuer, audience, algorithms: ['RS256'] }); return true; }
  catch { return false; }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return json({ status: 'ok' });
    if (!await authenticate(request, env)) return fail('접근 권한을 확인해 주세요.', 401);
    if (request.method !== 'POST') return fail('지원하지 않는 요청입니다.', 405);
    if (!['/songs', '/ppt-songs', '/search'].includes(path)) return fail('지원하지 않는 기능입니다.', 404);
    try {
      if (Number(request.headers.get('content-length') || 0) > 4096) return fail('요청이 너무 큽니다.', 413);
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 4096) return fail('요청이 너무 큽니다.', 413);
      let input;
      try { input = text ? JSON.parse(text) : {}; } catch { return fail('요청 형식을 확인해 주세요.', 400); }
      const data = path === '/search' ? await searchSongs(env.DB, input?.title)
        : await listSongs(env.DB, path === '/ppt-songs');
      return json({ success: true, data, error: null });
    } catch (error) {
      if (error instanceof TypeError) return fail('곡 제목을 확인해 주세요.', 400);
      return fail('곡 조회 중 오류가 발생했습니다.', 500);
    }
  },
};
