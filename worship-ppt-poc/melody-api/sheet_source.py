"""Find published score images and transcribe notation only (no audio inference)."""
import io
import copy
import hashlib
import logging
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image
from music21 import converter, meter, tempo, stream, metadata

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


def image_urls(page,title):
    body = score_article(page, title)
    if not body: return []
    attachments=[a['href'] for a in body.select('a[href]') if re.search(r'\.(?:jpg|png)(?:\?|$)',a['href'],re.I)]
    images=[i.get('data-original') or i.get('src','') for i in body.select('img')]
    return list(dict.fromkeys(urljoin(page,u) for u in attachments+images if u))[:6]


def notation_result(path,title,page,image):
    score=converter.parse(path)
    # The top staff / voice is the melody of the printed score, not a new
    # register guessed from audio. Preserve the original MusicXML for display.
    part=score.parts[0]
    mm=next(iter(score.recurse().getElementsByClass(tempo.MetronomeMark)),None)
    bpm=float(mm.number) if mm and mm.number else 100.0
    ts=next(iter(part.recurse().getElementsByClass(meter.TimeSignature)),None)
    recognized_key=part.analyze('key')
    notes=[]
    for item in part.flatten().notes:
        if len(item.pitches)>1:
            pitch=max(item.pitches,key=lambda p:p.midi)
        else: pitch=item.pitches[0]
        if item.quarterLength <= 0: continue
        notes.append(dict(pitch=int(pitch.midi),startTime=float(item.offset)*60/bpm,
                          duration=float(item.quarterLength)*60/bpm,beats=float(item.quarterLength),amplitude=1.0))
    if len(notes)<8: raise SheetError('음표를 충분히 인식하지 못했습니다.')
    # Broken/overfull measures need review; don't invent corrections here.
    return dict(title=title,sourceType='sheet-omr',sourcePage=page,sourceImage=image,
                originalMusicxml=None,
                key=recognized_key.tonic.name.replace('-', 'b')+('m' if recognized_key.mode=='minor' else ''),
                bpm=bpm,tempoEstimated=not bool(mm and mm.number),timeSignature=ts.ratioString if ts else '4/4',meterEstimated=ts is None,
                notes=notes,vocalStartSec=0,vocalEndSec=max(n['startTime']+n['duration'] for n in notes),
                notationTransposeSemitones=0,recognitionNeedsReview=True)


def find_score(title,artist=''):
    local=Path.home()/'.local/share/yebit/Audiveris.app/Contents/MacOS/Audiveris'
    executable=os.getenv('AUDIVERIS_BIN',str(local) if local.is_file() else '/Applications/Audiveris.app/Contents/MacOS/Audiveris')
    if not Path(executable).is_file(): raise SheetError('악보 이미지 인식 프로그램이 서버에 설정되지 않았습니다.')
    deadline=time.monotonic()+180
    for page in candidates(title):
        recognized=[]
        seen=set()
        try: urls=image_urls(page,title)
        except (requests.RequestException,SheetError): continue
        for url in urls:
            if time.monotonic()>deadline-10: raise SheetError('악보 이미지 검색·인식 시간이 초과됐습니다.')
            try:
                with tempfile.TemporaryDirectory(prefix='yebit-sheet-') as directory:
                    root=Path(directory); raw=fetch(url,True)
                    digest=hashlib.sha256(raw).hexdigest()
                    if digest in seen: continue
                    seen.add(digest)
                    with Image.open(io.BytesIO(raw)) as im:
                        if im.width<600 or im.height<250 or im.width*im.height>30000000: continue
                        im.convert('RGB').save(root/'score.png')
                    log.info('Recognizing published score title=%s page=%s',title,page)
                    with (root/'recognition.log').open('w') as output:
                        subprocess.run([executable,'-batch','-export','-output',str(root/'out'),str(root/'score.png')],
                                       stdout=output,stderr=subprocess.STDOUT,timeout=min(60,max(1,deadline-time.monotonic())),check=True)
                    files=list((root/'out').glob('*.mxl'))
                    if not files: continue
                    for file in sorted(files):
                        parsed=converter.parse(file)
                        part=parsed.parts[0]
                        measures=list(part.getElementsByClass('Measure'))
                        if len(measures)<2 or len(part.flatten().notes)<8:
                            log.warning('Rejected short score preview: %d measures',len(measures))
                            continue
                        # Different keys of the same score are alternatives, not pages.
                        pitches=[int(n.pitches[-1].midi) for n in part.flatten().notes]
                        signature=tuple(p-pitches[0] for p in pitches)
                        if any(signature==entry[2] for entry in recognized): continue
                        recognized.append((parsed,url,signature))
            except (requests.RequestException,SheetError,OSError,ValueError,subprocess.SubprocessError):
                log.exception('Score image failed: %s',urlparse(url).hostname)
        total_measures=sum(len(list(entry[0].parts[0].getElementsByClass('Measure'))) for entry in recognized)
        if recognized and total_measures>=8:
            combined=stream.Score()
            combined.metadata=metadata.Metadata(title=title)
            count=max(len(entry[0].parts) for entry in recognized)
            for index in range(count):
                destination=stream.Part()
                number=1
                for parsed,_,_ in recognized:
                    if index>=len(parsed.parts): continue
                    for measure in parsed.parts[index].getElementsByClass('Measure'):
                        measure=copy.deepcopy(measure);measure.number=number;number+=1
                        destination.append(measure)
                combined.insert(0,destination)
            with tempfile.TemporaryDirectory() as directory:
                file=combined.write('musicxml',fp=Path(directory)/'combined.musicxml')
                result=notation_result(file,title,page,recognized[0][1])
                result['originalMusicxml']=Path(file).read_text()
            result['sourceImages']=[entry[1] for entry in recognized]
            result['recognizedPages']=len(recognized)
            return result
    raise SheetError('이 곡의 인식 가능한 악보 이미지를 찾지 못했습니다. 곡 제목이나 악보 자료를 확인해 주세요.')
