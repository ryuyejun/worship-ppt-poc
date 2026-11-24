"""Render the pages of a published worship score presentation in order."""
import base64
import io
import logging
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from urllib.parse import unquote, urljoin, urlparse

import numpy as np
from PIL import Image
import requests

from sheet_source import SheetError, candidates, fetch, normalized, score_article

log = logging.getLogger(__name__)
SHEET_CACHE_VERSION = 'sheet-presentation-v1'
MAX_PAGES = 40


def presentation_links(page, title):
    article = score_article(page, title)
    if article is None:
        return []
    links = []
    for anchor in article.select('a[href]'):
        url = urljoin(page, anchor['href'])
        label = anchor.get_text(' ', strip=True)
        filename = unquote(urlparse(url).path.rsplit('/', 1)[-1])
        attachment = re.search(r'\.(pptx?)(?:\s|$)', label, re.I)
        if attachment is None:
            attachment = re.search(r'\.(pptx?)$', filename, re.I)
        if attachment is None or normalized(title) not in normalized(f'{label} {filename}'):
            continue
        wide = any(token in f'{label} {filename}'.lower() for token in ('wide', '와이드', '16:9', '16_9', '16-9'))
        links.append((wide, url, attachment.group(1).lower()))
    return sorted(dict.fromkeys(links), key=lambda link: not link[0])


def has_staff(image):
    """Require a regular set of five dark staff lines, even on a photo background."""
    width = min(image.width, 1200)
    height = max(1, round(image.height * width / image.width))
    gray = np.asarray(image.convert('L').resize((width, height), Image.Resampling.LANCZOS), dtype=np.int16)
    if height < 20:
        return False
    # A staff line is darker than the pixels immediately above and below it.
    # Use this local contrast as well as absolute brightness for photo backgrounds.
    contrast = (gray[:-6] + gray[6:]) / 2 - gray[3:-3]
    for ink in (gray < 110, (contrast > 11) & (gray[3:-3] < 195)):
        rows = np.flatnonzero(ink.mean(axis=1) > .15)
        centers = [float(np.mean(band)) for band in np.split(rows, np.flatnonzero(np.diff(rows) > 1) + 1)
                   if 0 < len(band) <= 4]
        for start in range(len(centers) - 4):
            distances = np.diff(centers[start:start + 5])
            spacing = float(np.median(distances))
            if 4 <= spacing <= 45 and np.max(np.abs(distances - spacing)) <= 1.8:
                return True
    return False


def render_presentation(data, extension, soffice, pdftoppm, deadline):
    def run(command):
        timeout = min(35, deadline - time.monotonic())
        if timeout <= 0:
            raise SheetError('예배용 악보를 불러오는 시간이 초과됐습니다.')
        subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, check=True)

    with tempfile.TemporaryDirectory(prefix='yebit-worship-score-') as directory:
        root = Path(directory)
        source = root / f'score.{extension}'
        source.write_bytes(data)
        profile = root / 'profile'
        (profile / 'user').mkdir(parents=True)
        (profile / 'user/registrymodifications.xcu').write_text(
            '<oor:items xmlns:oor="http://openoffice.org/2001/registry">'
            '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
            '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>'
            '</item></oor:items>', encoding='utf-8')
        run([soffice, f'-env:UserInstallation={profile.as_uri()}', '--headless', '--norestore',
             '--convert-to', 'pdf', '--outdir', str(root), str(source)])
        pdf = root / 'score.pdf'
        if not pdf.is_file():
            raise SheetError('원본 PPT를 열 수 없습니다.')
        run([pdftoppm, '-l', str(MAX_PAGES + 1), '-scale-to', '1600',
             '-png', str(pdf), str(root / 'slide')])
        files = sorted(root.glob('slide-*.png'), key=lambda path: int(path.stem.rsplit('-', 1)[-1]))
        if not 1 <= len(files) <= MAX_PAGES:
            raise SheetError('원본 PPT의 슬라이드 수를 지원하지 않습니다.')
        pages = []
        for file in files:
            with Image.open(file) as source_image:
                image = source_image.convert('RGB')
            if not has_staff(image):
                raise SheetError('악보 오선이 확인되지 않는 슬라이드가 있습니다.')
            image.thumbnail((1600, 900), Image.Resampling.LANCZOS)
            canvas = Image.new('RGB', (1600, 900), 'white')
            canvas.paste(image, ((1600 - image.width) // 2, (900 - image.height) // 2))
            encoded = io.BytesIO()
            canvas.save(encoded, 'JPEG', quality=93, subsampling=0)
            pages.append('data:image/jpeg;base64,' + base64.b64encode(encoded.getvalue()).decode('ascii'))
        return pages


def find_score_images(title, artist=''):
    soffice = shutil.which('soffice')
    pdftoppm = shutil.which('pdftoppm')
    if not soffice or not pdftoppm:
        raise SheetError('예배용 악보를 표시하는 데 필요한 변환 도구가 서버에 설치되지 않았습니다.')
    deadline = time.monotonic() + 150
    found_attachment = False
    for page in candidates(title):
        if time.monotonic() >= deadline:
            raise SheetError('예배용 악보를 불러오는 시간이 초과됐습니다.')
        try:
            links = presentation_links(page, title)
        except (requests.RequestException, SheetError):
            log.warning('Cannot read worship score post: %s', page)
            continue
        found_attachment |= bool(links)
        for _, url, extension in links[:2]:
            if time.monotonic() >= deadline:
                raise SheetError('예배용 악보를 불러오는 시간이 초과됐습니다.')
            try:
                data = fetch(url, binary=True)
                if not data.startswith((b'PK\x03\x04', b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')):
                    continue
                pages = render_presentation(data, extension, soffice, pdftoppm, deadline)
            except (requests.RequestException, SheetError, OSError, subprocess.SubprocessError) as exc:
                log.info('Cannot render worship score from %s: %s', page, exc)
                continue
            return dict(title=title, sourceType='sheet-image', sourcePage=page, sheetImages=pages)
    if found_attachment:
        raise SheetError('PPT 첨부파일을 찾았지만 오선이 있는 슬라이드로 열 수 없었습니다.')
    raise SheetError('검색한 자료원에서 이 곡의 예배용 악보 PPT를 찾지 못했습니다.')
