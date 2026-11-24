"""Search published score pages and fetch only from approved source hosts."""
import logging
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)
class SheetError(ValueError):
    pass


SCORE_SITES = (
    'cwy0675.tistory.com',
    'ccm4u.tistory.com',
    'dariuskim.com',
    'rialim.tistory.com',
    'peacecreator.tistory.com',
    'venti600ml.tistory.com',
)
SCORE_ASSET_HOSTS = {'ccmhymn.github.io', 'blog.kakaocdn.net', 't1.daumcdn.net'}


def normalized(text):
    return re.sub(r'[^가-힣a-z0-9]', '', unicodedata.normalize('NFC', text).casefold())


def fetch(url, binary=False):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in (*SCORE_SITES, *SCORE_ASSET_HOSTS):
        raise SheetError('지원하지 않는 악보 자료 주소입니다.')
    data = bytearray()
    with requests.get(url, timeout=15, stream=True, allow_redirects=False) as response:
        response.raise_for_status()
        if not response.ok or response.is_redirect:
            raise SheetError('악보 자료 주소가 변경되었습니다.')
        for chunk in response.iter_content(65536):
            data.extend(chunk)
            if len(data) > 15 * 1024 * 1024:
                raise SheetError('악보 자료가 너무 큽니다.')
    return bytes(data) if binary else bytes(data).decode('utf-8','replace')


def candidates(title):
    target = normalized(title)
    if len(target) < 3:
        raise SheetError('악보를 찾으려면 정확한 곡 제목이 필요합니다.')

    def search_site(host):
        site = f'https://{host}'
        try:
            soup = BeautifulSoup(fetch(site + '/search/' + quote(title, safe='')), 'html.parser')
        except (requests.RequestException, SheetError):
            log.warning('Score search unavailable: %s', host)
            return []

        matches = {}
        for anchor in soup.select('a[href]'):
            url = urljoin(site, anchor['href'])
            parsed = urlparse(url)
            path = unquote(parsed.path)
            if parsed.hostname != host or not ('/entry/' in path or re.fullmatch(r'/(?:m/)?\d+', path)):
                continue
            heading = anchor.select_one('h2,h3,.title,.tit_post,.tit_thumb')
            label = heading.get_text(' ', strip=True) if heading else anchor.get_text(' ', strip=True)[:150]
            if target not in normalized(label) or any(word in label for word in ('모음', '목록', '시리즈')):
                continue
            canonical_path = parsed.path.removeprefix("/m") if re.fullmatch(r"/m/\d+", path) else parsed.path
            canonical = site + canonical_path
            priority = int('ppt' in label.casefold())
            matches[canonical] = max(priority, matches.get(canonical, 0))
        return sorted(matches, key=matches.get, reverse=True)[:2]

    with ThreadPoolExecutor(max_workers=len(SCORE_SITES)) as executor:
        return [url for matches in executor.map(search_site, SCORE_SITES) for url in matches]


def score_article(page, title):
    soup=BeautifulSoup(fetch(page),'html.parser')
    heading=soup.select_one('h1,h2.title,.title_view,.tit_post')
    # og:title is more consistent across different Tistory skins.
    meta=soup.select_one('meta[property="og:title"]')
    label=meta.get('content','') if meta else (heading.get_text() if heading else '')
    if normalized(title) not in normalized(label):
        return None
    return soup.select_one('.tt_article_useless_p_margin,.contents_style')
