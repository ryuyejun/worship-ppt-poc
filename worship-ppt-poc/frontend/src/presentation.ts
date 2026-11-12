import type { Song } from './types';

export type SlideStyle = { backgroundColor: string; textColor: string; fontFamily: string; fontSize: number; alignment: 'LEFT' | 'CENTER' | 'RIGHT'; linesPerSlide: number; bold: boolean; backgroundImageBase64?: string; backgroundImageType?: string };
export type SlideSize = { width: number; height: number };
export type PresentationInput = { slideSize?: SlideSize; songIds: number[]; externalSongs?: { id: number; title: string; artist: string | null; lyrics: string }[]; pptxBase64?: string; style: SlideStyle };
export type Slide = { title: string; lines: string[] };
const lyricCache = new Map<number, Song>();

export function splitLyrics(lyrics: string, perSlide: number): string[][] {
  if (!lyrics.trim()) throw new Error('가사가 없습니다.');
  if (!Number.isInteger(perSlide) || perSlide < 1 || perSlide > 6) throw new Error('한 장의 줄 수는 1~6이어야 합니다.');
  const slides: string[][] = []; let section: string[] = [];
  const flush = () => { for (let i = 0; i < section.length; i += perSlide) slides.push(section.slice(i, i + perSlide)); section = []; };
  for (const line of lyrics.split(/\r\n|\r|\n/)) {
    if (!line.trim() || /^\[[^\[\]\r\n]{1,40}\]$/.test(line.trim())) flush(); else section.push(line);
  }
  flush();
  return slides;
}

export async function collectSlides(input: PresentationInput, signal?: AbortSignal): Promise<Slide[]> {
  if (!Array.isArray(input.songIds) || !input.songIds.length || input.songIds.length > 100) throw new Error('곡을 1곡 이상 100곡 이하로 선택하세요.');
  if (input.pptxBase64) throw new Error('기존 PPTX에 추가하는 기능은 Cloudflare 전환 중입니다. 새 PPTX로 만들어 주세요.');
  const external = new Map((input.externalSongs || []).map(song => [song.id, song]));
  const songs = await Promise.all(input.songIds.map(async id => {
    if (id < 0) { const song = external.get(id); if (!song?.lyrics.trim()) throw new Error('선택한 곡에 가사가 없습니다.'); return song; }
    let song = lyricCache.get(id);
    if (!song) {
      const response = await fetch('/song', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), signal });
      if (!response.ok) throw new Error('선택한 곡의 가사를 불러오지 못했습니다.');
      const result = await response.json() as { success: boolean; data: Song | null };
      if (!result.success || !result.data?.lyrics?.trim()) throw new Error('선택한 곡에 가사가 없습니다.');
      song = result.data;
      lyricCache.set(id, song);
    }
    if (!song.lyrics?.trim()) throw new Error('선택한 곡에 가사가 없습니다.');
    return { id, title: song.title, artist: song.artist, lyrics: song.lyrics };
  }));
  const slides = songs.flatMap(song => splitLyrics(song.lyrics, input.style.linesPerSlide).map(lines => ({ title: song.title, lines })));
  if (!slides.length) throw new Error('표시할 가사 줄이 없습니다.');
  return slides;
}

export async function makePresentation(slides: Slide[], style: SlideStyle, size = {width:1280,height:720}): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const ppt = new PptxGenJS(); ppt.defineLayout({ name:'CUSTOM', width:size.width/96, height:size.height/96 }); ppt.layout = 'CUSTOM';
  const alignment = { LEFT: 'left', CENTER: 'center', RIGHT: 'right' } as const;
  for (const item of slides) {
    const slide = ppt.addSlide();
    slide.background = { color: style.backgroundColor.replace('#', '') };
    if (style.backgroundImageBase64 && style.backgroundImageType) {
      const type = style.backgroundImageType === 'PNG' ? 'png' : 'jpeg';
      slide.addImage({ data: `data:image/${type};base64,${style.backgroundImageBase64}`, x: 0, y: 0, w: size.width/96, h: size.height/96 });
    }
    slide.addText(item.lines.join('\n'), { x: size.width*60/1280/96, y: size.height*120/720/96, w: size.width*840/1280/96, h: size.height*300/720/96,
      fontFace: style.fontFamily, fontSize: style.fontSize, color: style.textColor.replace('#', ''),
      bold: style.bold, align: alignment[style.alignment], valign: 'middle', margin: 0 });
  }
  const data = await ppt.write({ outputType: 'blob' });
  if (!(data instanceof Blob)) throw new Error('PPTX를 생성하지 못했습니다.');
  return data;
}

export async function renderSlide(slide: Slide, style: SlideStyle, width = 1280, size = {width:1280,height:720}): Promise<string> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.round(width * size.height / size.width);
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('미리보기를 만들 수 없습니다.');
  ctx.scale(canvas.width / size.width, canvas.height / size.height);
  ctx.fillStyle = style.backgroundColor; ctx.fillRect(0, 0, size.width, size.height);
  if (style.backgroundImageBase64 && style.backgroundImageType) {
    const image = new Image(); image.src = `data:image/${style.backgroundImageType === 'PNG' ? 'png' : 'jpeg'};base64,${style.backgroundImageBase64}`;
    await image.decode(); ctx.drawImage(image, 0, 0, size.width, size.height);
  }
  const fontPx = style.fontSize * 4 / 3; const height = fontPx * 1.2;
  ctx.font = `${style.bold ? 'bold ' : ''}${fontPx}px "${style.fontFamily.replace(/["\\]/g, '')}", sans-serif`;
  ctx.fillStyle = style.textColor; ctx.textBaseline = 'middle'; ctx.textAlign = { LEFT: 'left', CENTER: 'center', RIGHT: 'right' }[style.alignment] as CanvasTextAlign;
  const wrapped: string[] = [];
  for (const line of slide.lines) {
    let part = '';
    for (const char of line) { if (part && ctx.measureText(part + char).width > 1120) { wrapped.push(part); part = char; } else part += char; }
    wrapped.push(part);
  }
  const x = style.alignment === 'LEFT' ? 80 : style.alignment === 'RIGHT' ? 1200 : 640;
  const y = 360 - (wrapped.length - 1) * height / 2;
  ctx.save(); ctx.beginPath(); ctx.rect(80, 160, 1120, 400); ctx.clip();
  wrapped.forEach((line, index) => ctx.fillText(line, x, y + index * height)); ctx.restore();
  return canvas.toDataURL('image/png').split(',')[1];
}
