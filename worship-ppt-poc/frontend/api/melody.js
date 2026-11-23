import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';

const DEFAULT_API_ORIGIN = 'https://yebit-web-test.yjryu.workers.dev';
const SCORE_SITES = [
  'cwy0675.tistory.com', 'ccm4u.tistory.com', 'dariuskim.com', 'rialim.tistory.com',
  'peacecreator.tistory.com', 'venti600ml.tistory.com', 'anemoneya.tistory.com',
  'soil1228.tistory.com', 'colordiary.tistory.com', 'w-decrecendo.tistory.com',
];
const FILE_HOSTS = new Set(['ccmhymn.github.io', 'blog.kakaocdn.net', 't1.daumcdn.net', 'download.blog.naver.com']);
const NAVER_HOST = 'm.blog.naver.com';
const NAVER_ATTACHMENT_HOST = 'download.blog.naver.com';
const NAVER_BLOG_ID = 'hyunakk';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_RANGE_BYTES = 3 * 1024 * 1024;

export const config = { api: { bodyParser: false } };

function sendJson(res, status, error) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ error }));
}

function cookiesFrom(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function mergeCookies(existing, setCookies) {
  const values = new Map(existing.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
  for (const value of setCookies) {
    const pair = value.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index >= 0) values.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return [...values].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function requireLogin(req, res) {
  const apiOrigin = String(process.env.YEBIT_API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/$/, '');
  let browserCookies = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  if (!browserCookies) {
    sendJson(res, 401, '로그인이 필요합니다.');
    return false;
  }
  const headers = { Cookie: browserCookies, Origin: apiOrigin, Accept: 'application/json' };
  try {
    const auth = await fetch(new URL('/auth/me', apiOrigin), { headers, signal: AbortSignal.timeout(8000) });
    if (auth.status === 401) {
      const refreshed = await fetch(new URL('/auth/refresh', apiOrigin), {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(8000),
      });
      if (!refreshed.ok) {
        sendJson(res, 401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
        return false;
      }
      const setCookies = cookiesFrom(refreshed.headers);
      if (setCookies.length) {
        res.setHeader('set-cookie', setCookies);
        browserCookies = mergeCookies(browserCookies, setCookies);
      }
    } else if (!auth.ok) {
      sendJson(res, 503, '로그인 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      return false;
    }
    req.yebitCookies = browserCookies;
    req.yebitApiOrigin = apiOrigin;
    return true;
  } catch {
    sendJson(res, 503, '로그인 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    return false;
  }
}

function normalize(value) {
  return String(value || '').normalize('NFC').toLocaleLowerCase('ko-KR').replace(/[^가-힣a-z0-9]/g, '');
}

function matchesTitle(title, label) {
  const target = normalize(title);
  const text = String(label || '').normalize('NFC').toLocaleLowerCase('ko-KR');
  if (target.length < 3) {
    const stripped = text.replace(/^\s*(?:\[[^\]]+\]\s*)+/, '');
    return new RegExp(`^[“"「]?\\s*${target}[”"」]?(?=\\s*(?:$|[._(/|:–-]|ppt\\b|악보\\b|가사\\b|찬양 ppt\\b))`, 'i').test(stripped);
  }
  const pattern = [...target].map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s._·-]*');
  const first = /[가-힣]/.test(target[0]) ? '가-힣' : 'a-z0-9';
  const last = /[가-힣]/.test(target.at(-1)) ? '가-힣' : 'a-z0-9';
  return new RegExp(`(?<![${first}])${pattern}(?![${last}])`, 'i').test(text);
}

function naverPostMatchesTitle(title, label) {
  const suffix = String(label || '').match(/\s*(?:[/|]\s*|\s+)(?:악보|ppt|가사)\b/i);
  const songTitle = suffix ? String(label).slice(0, suffix.index) : String(label || '');
  return normalize(songTitle) === normalize(title);
}

function safePageUrl(value, allowedHosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && allowedHosts.has(url.hostname) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

async function readLimited(response, limit) {
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('자료 페이지가 너무 큽니다.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function fetchHtml(value, allowedHosts) {
  const url = safePageUrl(value, allowedHosts);
  if (!url) throw new Error('지원하지 않는 악보 자료 주소입니다.');
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YebitScoreSearch/1.0)', Accept: 'text/html' },
    redirect: 'manual',
    signal: AbortSignal.timeout(9000),
  });
  const finalUrl = safePageUrl(response.url, allowedHosts);
  if (!finalUrl || !response.ok) throw new Error('자료 페이지를 열지 못했습니다.');
  return { $: load((await readLimited(response, 2 * 1024 * 1024)).toString('utf8')), url: finalUrl };
}

async function naverCandidates(title) {
  const query = new URLSearchParams({ blogId: NAVER_BLOG_ID, searchText: title });
  const site = `https://${NAVER_HOST}`;
  try {
    const { $ } = await fetchHtml(`${site}/PostSearchList.naver?${query}`, new Set([NAVER_HOST]));
    const found = new Map();
    $('a[href][data-ba-contents-type="post"]').each((_, element) => {
      const anchor = $(element);
      const label = anchor.text();
      if (!naverPostMatchesTitle(title, label)) return;
      const parsed = safePageUrl(new URL(anchor.attr('href'), site).href, new Set([NAVER_HOST]));
      if (!parsed || parsed.pathname !== '/PostView.naver') return;
      const params = parsed.searchParams;
      const postId = params.get('logNo') || '';
      if (params.get('blogId') !== NAVER_BLOG_ID || !/^\d+$/.test(postId)) return;
      found.set(`${site}/${NAVER_BLOG_ID}/${postId}`, /ppt/i.test(label));
    });
    return [...found].sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 3).map(([url]) => url);
  } catch {
    return [];
  }
}

async function siteCandidates(host, title) {
  const site = `https://${host}`;
  try {
    const { $ } = await fetchHtml(`${site}/search/${encodeURIComponent(title)}`, new Set([host]));
    const found = new Map();
    $('a[href]').each((_, element) => {
      const anchor = $(element);
      let url;
      try { url = new URL(anchor.attr('href'), site); } catch { return; }
      if (url.hostname !== host || !(/\/entry\//.test(decodeURIComponent(url.pathname)) || /^\/(?:m\/)?\d+$/.test(decodeURIComponent(url.pathname)))) return;
      const heading = anchor.find('h2,h3,.title,.tit_post,.tit_thumb').first();
      const label = (heading.length ? heading : anchor).text().trim().slice(0, 150);
      if (!matchesTitle(title, label) || ['모음', '목록', '시리즈'].some(word => label.includes(word))) return;
      const path = decodeURIComponent(url.pathname);
      if (/^\/m\/\d+$/.test(path)) url.pathname = path.slice(2);
      url.search = '';
      url.hash = '';
      found.set(url.href, [normalize(label) === normalize(title), /ppt/i.test(label)]);
    });
    return [...found].sort((a, b) => Number(b[1][0]) - Number(a[1][0]) || Number(b[1][1]) - Number(a[1][1]))
      .slice(0, 3).map(([url]) => url);
  } catch {
    return [];
  }
}

async function findCandidates(title) {
  const target = normalize(title);
  if (target.length < 2) throw new Error('악보를 찾으려면 곡 제목을 입력해 주세요.');
  const results = await Promise.all([
    naverCandidates(title),
    ...SCORE_SITES.map(host => siteCandidates(host, title)),
  ]);
  return [0, 1, 2].flatMap(index => results.flatMap(items => items[index] ? [items[index]] : []));
}

function attachmentLinks($, article, page, title) {
  const result = [];
  article.find('a[href]').each((_, element) => {
    const anchor = $(element);
    let url;
    try { url = new URL(anchor.attr('href'), page); } catch { return; }
    const label = anchor.text().trim();
    let filename = decodeURIComponent(url.pathname.split('/').at(-1) || '');
    const extension = (label.match(/\.(pptx?)(?:\s|$)/i) || filename.match(/\.(pptx?)$/i))?.[1]?.toLowerCase();
    if (!extension) return;
    if (url.protocol !== 'https:' || !FILE_HOSTS.has(url.hostname) || !url.pathname) return;
    if (url.hostname === NAVER_ATTACHMENT_HOST && (new URL(page).hostname !== NAVER_HOST || !url.pathname.startsWith('/open/'))) return;
    if (!matchesTitle(title, `${label} ${filename}`)) return;
    const description = `${label} ${filename}`.toLocaleLowerCase('ko-KR');
    const priority = [!/(가사만|가사용|자막용)/.test(description), description.includes('악보'), /wide|와이드|16[:_-]9/.test(description)];
    result.push({ url: url.href, extension, label, priority });
  });
  return result.sort((a, b) => Number(b.priority[0]) - Number(a.priority[0])
    || Number(b.priority[1]) - Number(a.priority[1]) || Number(b.priority[2]) - Number(a.priority[2]));
}

async function findPresentation(title, artist) {
  const pages = await findCandidates(title);
  const pageHosts = new Set([...SCORE_SITES, NAVER_HOST]);
  const articles = await Promise.all(pages.map(async page => {
    try {
      const { $ } = await fetchHtml(page, pageHosts);
      const metaTitle = $('meta[property="og:title"]').attr('content');
      const heading = $('h1,h2.title,.title_view,.tit_post').first().text();
      const label = metaTitle || heading;
      const naver = new URL(page).hostname === NAVER_HOST;
      if (naver ? !naverPostMatchesTitle(title, label) : !matchesTitle(title, label)) return null;
      const article = naver
        ? $('.files').first()
        : $('.tt_article_useless_p_margin,.contents_style').first();
      if (!article.length) return null;
      return { page, links: attachmentLinks($, article, page, title) };
    } catch {
      return null;
    }
  }));
  const all = articles.filter(Boolean).flatMap(article => article.links.map(link => ({ ...link, page: article.page })));
  all.sort((a, b) => {
    const exactArtistA = artist && normalize(`${a.label} ${a.page}`).includes(normalize(artist));
    const exactArtistB = artist && normalize(`${b.label} ${b.page}`).includes(normalize(artist));
    return Number(exactArtistB) - Number(exactArtistA)
      || Number(b.priority[0]) - Number(a.priority[0])
      || Number(b.priority[1]) - Number(a.priority[1])
      || Number(b.priority[2]) - Number(a.priority[2]);
  });
  for (const item of all) {
    return { sourcePage: item.page, sourceFileUrl: item.url, sourceFileType: item.extension };
  }
  throw new Error('검색한 자료원에서 곡 제목이 일치하는 악보 파일을 찾지 못했습니다.');
}

async function submitSearch(req, res, incoming) {
  const title = (incoming.searchParams.get('title') || '').trim().slice(0, 120);
  const artist = (incoming.searchParams.get('artist') || '').trim().slice(0, 120);
  if (!title) return sendJson(res, 400, '곡 제목을 입력해 주세요.');
  try {
    const { sourcePage, sourceFileUrl, sourceFileType } = await findPresentation(title, artist);
    const fileUrl = new URL('/api/auto-melody/source', incoming);
    fileUrl.searchParams.set('url', sourceFileUrl);
    fileUrl.searchParams.set('type', sourceFileType);
    const score = {
      title, sourceType: 'sheet-image', sourcePage, sourceFileUrl: fileUrl.pathname + fileUrl.search,
      bpm: 100, vocalStartSec: 0, vocalEndSec: 0, notes: [], reviewed: false,
    };
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ jobId: randomUUID().replaceAll('-', ''), state: 'ready', revision: 1, score }));
  } catch (error) {
    sendJson(res, 404, error instanceof Error ? error.message : '악보 파일을 찾지 못했습니다.');
  }
}

function allowedFileUrl(value, type) {
  const url = safePageUrl(value, FILE_HOSTS);
  if (!url) return null;
  if (url.hostname === NAVER_ATTACHMENT_HOST && !url.pathname.startsWith('/open/')) return null;
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
  const pathType = pathname.match(/\.(pptx?)$/i)?.[1]?.toLowerCase();
  const declaredType = String(type || '').toLowerCase();
  if (pathType && pathType !== declaredType) return null;
  if (!pathType && !['ppt', 'pptx'].includes(declaredType)) return null;
  return { url, type: pathType || declaredType };
}

async function servePresentation(req, res, incoming) {
  const file = allowedFileUrl(incoming.searchParams.get('url') || '', incoming.searchParams.get('type'));
  if (!file) return sendJson(res, 400, '지원하지 않는 악보 파일 주소입니다.');
  const requested = req.headers.range || '';
  const range = requested.match(/^bytes=(\d+)-(\d+)$/);
  if (requested && (!range || Number(range[2]) < Number(range[1]) || Number(range[2]) - Number(range[1]) + 1 > MAX_RANGE_BYTES)) {
    return sendJson(res, 416, '악보 파일 범위가 올바르지 않습니다.');
  }
  try {
    const upstream = await fetch(file.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YebitScoreSearch/1.0)', ...(requested ? { Range: requested } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) return sendJson(res, upstream.status, '원본 악보 파일을 다운로드하지 못했습니다.');
    const totalHeader = upstream.headers.get('content-range')?.match(/\/([0-9]+)$/)?.[1];
    const contentType = upstream.headers.get('content-type') || (file.type === 'ppt'
      ? 'application/vnd.ms-powerpoint'
      : 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const cacheControl = 'private, max-age=300';
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (upstream.status === 206) {
        const body = await readLimited(upstream, MAX_RANGE_BYTES);
        res.statusCode = 206;
        res.setHeader('content-type', contentType);
        res.setHeader('content-range', upstream.headers.get('content-range') || `bytes ${start}-${start + body.length - 1}/${totalHeader || '*'}`);
        res.setHeader('accept-ranges', 'bytes');
        res.setHeader('content-length', String(body.length));
        res.setHeader('cache-control', cacheControl);
        return res.end(body);
      }
      const complete = await readLimited(upstream, MAX_FILE_BYTES);
      const part = complete.subarray(start, Math.min(end + 1, complete.length));
      if (start >= complete.length) return sendJson(res, 416, '악보 파일 범위가 올바르지 않습니다.');
      res.statusCode = 206;
      res.setHeader('content-type', contentType);
      res.setHeader('content-range', `bytes ${start}-${start + part.length - 1}/${complete.length}`);
      res.setHeader('accept-ranges', 'bytes');
      res.setHeader('content-length', String(part.length));
      res.setHeader('cache-control', cacheControl);
      return res.end(part);
    }
    const body = await readLimited(upstream, MAX_FILE_BYTES);
    res.statusCode = 200;
    res.setHeader('content-type', contentType);
    res.setHeader('content-length', String(body.length));
    res.setHeader('cache-control', cacheControl);
    res.end(body);
  } catch (error) {
    sendJson(res, 502, error instanceof Error ? error.message : '원본 악보 파일을 불러오지 못했습니다.');
  }
}

export default async function handler(req, res) {
  const incoming = new URL(req.url || '/', 'http://vercel.local');
  const path = (incoming.searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');
  if (path !== 'jobs' && path !== 'source') return sendJson(res, 404, '지원하지 않는 악보 요청입니다.');
  if (!await requireLogin(req, res)) return;
  if (path === 'jobs') {
    if (req.method !== 'POST') return sendJson(res, 405, '지원하지 않는 요청입니다.');
    return submitSearch(req, res, incoming);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, '지원하지 않는 요청입니다.');
  return servePresentation(req, res, incoming);
}
