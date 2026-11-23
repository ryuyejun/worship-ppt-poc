const API_ORIGIN = process.env.YEBIT_API_ORIGIN || 'https://yebit-web-test.yjryu.workers.dev';
const AUTH_PATHS = new Set(['/auth/me', '/auth/signup', '/auth/login', '/auth/refresh', '/auth/logout']);

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const incomingUrl = new URL(req.url || '/', 'http://vercel.local');
  const path = incomingUrl.searchParams.get('path') || '';
  if (!AUTH_PATHS.has(path)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  const upstreamUrl = new URL(path, API_ORIGIN);
  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'cookie', 'x-local-token']) {
    const value = req.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  // The Worker checks Origin against its own URL. Normalize it here while
  // retaining the browser's same-origin session cookies.
  headers.set('origin', API_ORIGIN);

  const method = req.method || 'GET';
  try {
    const response = await fetch(upstreamUrl, {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: req, duplex: 'half' }),
    });

    res.statusCode = response.status;
    for (const name of ['content-type', 'cache-control', 'x-content-type-options']) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    const cookies = response.headers.getSetCookie?.();
    if (cookies?.length) res.setHeader('set-cookie', cookies);
    else {
      const cookie = response.headers.get('set-cookie');
      if (cookie) res.setHeader('set-cookie', cookie);
    }

    if (method === 'HEAD' || response.status === 204 || response.status === 304) {
      res.end();
      return;
    }
    const body = Buffer.from(await response.arrayBuffer());
    res.setHeader('content-length', String(body.length));
    res.end(body);
  } catch {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: false, data: null, error: 'Yebit 서버에 연결하지 못했습니다.' }));
  }
}
