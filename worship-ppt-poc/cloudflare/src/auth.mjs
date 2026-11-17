const ACCESS_COOKIE = '__Host-yebit_access';
const REFRESH_COOKIE = '__Host-yebit_refresh';
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_HASH_ITERATIONS = 100_000;
const encoder = new TextEncoder();

const response = (body, status = 200, cookies = []) => {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return Response.json(body, { status, headers });
};
const success = (data, cookies) => response({ success: true, data, error: null }, 200, cookies);
const failure = (message, status) => response({ success: false, data: null, error: message }, status);

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function readCookie(request, name) {
  const prefix = `${name}=`;
  const rawCookie = request.headers.get('Cookie') || '';
  const value = rawCookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : '';
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function clearCookies() {
  return [cookie(ACCESS_COOKIE, '', 0), cookie(REFRESH_COOKIE, '', 0)];
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 4096) return null;
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_HASH_ITERATIONS }, key, 256));
}

async function hashToken(token) {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))));
}

async function accessKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function createAccessToken(user, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = encodeBase64Url(encoder.encode(JSON.stringify({ sub: String(user.id), email: user.email, iss: 'yebit', aud: 'yebit-web', iat: now, exp: now + ACCESS_TTL_SECONDS })));
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await accessKey(secret), encoder.encode(signingInput)));
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

async function verifyAccessToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    if (header.alg !== 'HS256' || payload.iss !== 'yebit' || payload.aud !== 'yebit-web' || !/^\d+$/.test(payload.sub || '') || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    const valid = await crypto.subtle.verify('HMAC', await accessKey(secret), decodeBase64Url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    return valid ? { id: Number(payload.sub), email: String(payload.email || '') } : null;
  } catch { return null; }
}

function newRefreshToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return encodeBase64Url(bytes);
}

async function issueSession(db, user, secret) {
  const refreshToken = newRefreshToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000).toISOString();
  await db.prepare('INSERT INTO auth_sessions (id, user_id, refresh_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.id, await hashToken(refreshToken), now.toISOString(), expiresAt, now.toISOString()).run();
  const accessToken = await createAccessToken(user, secret);
  return [cookie(ACCESS_COOKIE, accessToken, ACCESS_TTL_SECONDS), cookie(REFRESH_COOKIE, refreshToken, REFRESH_TTL_SECONDS)];
}

function normalizedEmail(input) {
  const email = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export async function verifyAccessCookie(request, env) {
  const token = readCookie(request, ACCESS_COOKIE);
  if (!token || !env.AUTH_ACCESS_SECRET) return null;
  return verifyAccessToken(token, env.AUTH_ACCESS_SECRET);
}

export async function handleAuthRequest(request, env, path) {
  if (!env.AUTH_ACCESS_SECRET || env.AUTH_ACCESS_SECRET.length < 32) return failure('로그인 설정을 사용할 수 없습니다. 관리자에게 문의해 주세요.', 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return failure('요청 출처가 올바르지 않습니다.', 403);

  if (path === '/auth/me') {
    if (request.method !== 'GET') return failure('지원하지 않는 요청입니다.', 405);
    const user = await verifyAccessCookie(request, env);
    return user ? success({ user }) : failure('로그인이 필요합니다.', 401);
  }
  if (!['/auth/signup', '/auth/login', '/auth/refresh', '/auth/logout'].includes(path) || request.method !== 'POST') return failure('지원하지 않는 인증 요청입니다.', 405);

  if (path === '/auth/logout') {
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    if (refreshToken) await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE refresh_hash = ? AND revoked_at IS NULL').bind(new Date().toISOString(), await hashToken(refreshToken)).run();
    return success({ loggedOut: true }, clearCookies());
  }

  if (path === '/auth/refresh') {
    const oldToken = readCookie(request, REFRESH_COOKIE);
    if (!oldToken) return response({ success: false, data: null, error: '로그인이 만료되었습니다.' }, 401, clearCookies());
    const oldHash = await hashToken(oldToken);
    const session = await env.DB.prepare(`SELECT s.id AS sessionId, s.user_id AS userId, u.email FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
      WHERE s.refresh_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? LIMIT 1`).bind(oldHash, new Date().toISOString()).first();
    if (!session) return response({ success: false, data: null, error: '로그인이 만료되었습니다.' }, 401, clearCookies());
    const refreshToken = newRefreshToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000).toISOString();
    const update = await env.DB.prepare('UPDATE auth_sessions SET refresh_hash = ?, expires_at = ?, last_used_at = ? WHERE id = ? AND refresh_hash = ? AND revoked_at IS NULL')
      .bind(await hashToken(refreshToken), expiresAt, now.toISOString(), session.sessionId, oldHash).run();
    if (update.meta?.changes !== 1) return response({ success: false, data: null, error: '다른 곳에서 로그인이 갱신되었습니다.' }, 401, clearCookies());
    const accessToken = await createAccessToken({ id: session.userId, email: session.email }, env.AUTH_ACCESS_SECRET);
    return success({ user: { id: session.userId, email: session.email } }, [cookie(ACCESS_COOKIE, accessToken, ACCESS_TTL_SECONDS), cookie(REFRESH_COOKIE, refreshToken, REFRESH_TTL_SECONDS)]);
  }

  const input = await readBody(request);
  if (!input || typeof input !== 'object') return failure('입력 형식을 확인해 주세요.', 400);
  const email = normalizedEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';
  if (!email) return failure('올바른 이메일 주소를 입력해 주세요.', 400);
  if (password.length < 10 || password.length > 128) return failure('비밀번호는 10자 이상 128자 이하로 입력해 주세요.', 400);

  let user;
  if (path === '/auth/signup') {
    const existing = await env.DB.prepare('SELECT id FROM auth_users WHERE email = ? COLLATE NOCASE LIMIT 1').bind(email).first();
    if (existing) return failure('이미 가입된 이메일입니다.', 409);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await derivePassword(password, salt);
    try {
      const result = await env.DB.prepare('INSERT INTO auth_users (email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)')
        .bind(email, encodeBase64Url(passwordHash), encodeBase64Url(salt), new Date().toISOString()).run();
      user = { id: Number(result.meta?.last_row_id), email };
    } catch {
      return failure('이미 가입된 이메일입니다.', 409);
    }
  } else {
    user = await env.DB.prepare('SELECT id, email, password_hash AS passwordHash, password_salt AS passwordSalt FROM auth_users WHERE email = ? COLLATE NOCASE LIMIT 1').bind(email).first();
    if (!user) return failure('이메일 또는 비밀번호가 올바르지 않습니다.', 401);
    const candidateHash = await derivePassword(password, decodeBase64Url(user.passwordSalt));
    if (!equalBytes(candidateHash, decodeBase64Url(user.passwordHash))) return failure('이메일 또는 비밀번호가 올바르지 않습니다.', 401);
  }

  const cookies = await issueSession(env.DB, user, env.AUTH_ACCESS_SECRET);
  return success({ user: { id: user.id, email: user.email } }, cookies);
}
