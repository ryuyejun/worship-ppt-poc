import type { AutoMelody } from './auto-melody';
import type { Song } from './types';

export type SlideTextPosition = { x: number; y: number; width: number; height: number };
export type SlideStyle = { backgroundColor: string; textColor: string; fontFamily: string; fontSize: number; alignment: 'LEFT' | 'CENTER' | 'RIGHT'; linesPerSlide: number; bold: boolean; textX?: number; textY?: number; textWidth?: number; textHeight?: number; backgroundImageBase64?: string; backgroundImageType?: string };
export type SlideSize = { width: number; height: number };
export type PresentationInput = { slideSize?: SlideSize; songIds: number[]; externalSongs?: { id: number; title: string; artist: string | null; lyrics: string }[]; autoMelodies?: Record<number, AutoMelody>; extraSlides?: number; removedSlideIndexes?: number[]; slideOrder?: number[]; slidePositions?: Record<number, SlideTextPosition>; slideTextOverrides?: Record<number, string>; slideTextColors?: Record<number, string>; pptxBase64?: string; style: SlideStyle };
export function normalizeSlideOrder(order: number[] | undefined, count: number): number[] {
  const valid = (order ?? []).filter((index, position, indexes) => Number.isInteger(index) && index >= 0 && index < count && indexes.indexOf(index) === position);
  const included = new Set(valid);
  return [...valid, ...Array.from({ length: count }, (_, index) => index).filter(index => !included.has(index))];
}
export type Slide = { scorePageImage?: string; title: string; lines: string[]; textPosition?: SlideTextPosition; textColor?: string };
const lyricCache = new Map<number, Song>();

function lyricLineWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (/\s/u.test(char)) units += 0.32;
    else if (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff01-\uff60]/u.test(char)) units += 1;
    else if (/[MW@#%&]/i.test(char)) units += 0.82;
    else if (/[il.,'`!:;|]/i.test(char)) units += 0.3;
    else units += 0.56;
  }
  return units * (fontSize * 96 / 72);
}

function wrapLyricLine(line: string, maxWidth: number, fontSize: number): string[] {
  const words = line.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  const wordWidths = words.map(word => lyricLineWidth(word, fontSize));
  if (wordWidths.every(width => width <= maxWidth)) {
    return balanceLyricWords(words, wordWidths, maxWidth, lyricLineWidth(' ', fontSize));
  }

  // Keep character wrapping available for a word wider than the slide.
  const wrapped: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && lyricLineWidth(candidate, fontSize) > maxWidth) {
      wrapped.push(current);
      current = '';
    }
    if (lyricLineWidth(word, fontSize) <= maxWidth) {
      current = current ? `${current} ${word}` : word;
      continue;
    }
    for (const char of word) {
      const part = current ? `${current}${char}` : char;
      if (current && lyricLineWidth(part, fontSize) > maxWidth) {
        wrapped.push(current);
        current = char;
      } else current = part;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

function balanceLyricWords(words: string[], widths: number[], maxWidth: number, spaceWidth: number): string[] {
  const count = words.length;
  // For each suffix, use the fewest rows, then prefer more even row widths.
  // With a fixed row count and total text width, minimizing squared widths
  // also minimizes the variation in width between rows.
  const rowCounts = new Array<number>(count + 1).fill(Infinity);
  const costs = new Array<number>(count + 1).fill(Infinity);
  const next = new Array<number>(count);
  rowCounts[count] = 0;
  costs[count] = 0;

  for (let start = count - 1; start >= 0; start--) {
    let width = 0;
    for (let end = start + 1; end <= count; end++) {
      width += widths[end - 1] + (end === start + 1 ? 0 : spaceWidth);
      if (width > maxWidth) break;
      const rows = rowCounts[end] + 1;
      const cost = width ** 2 + costs[end];
      if (rows < rowCounts[start] || (rows === rowCounts[start] && cost < costs[start])) {
        rowCounts[start] = rows;
        costs[start] = cost;
        next[start] = end;
      }
    }
  }

  const lines: string[] = [];
  for (let start = 0; start < count; start = next[start]) {
    lines.push(words.slice(start, next[start]).join(' '));
  }
  return lines;
}

export function splitLyrics(lyrics: string, perSlide: number, layout?: { width: number; fontSize: number; maxTextWidth: number }): string[][] {
  if (!lyrics.trim()) throw new Error('가사가 없습니다.');
  if (!Number.isInteger(perSlide) || perSlide < 1 || perSlide > 6) throw new Error('한 장의 줄 수는 1~6이어야 합니다.');
  const slides: string[][] = []; let section: string[] = [];
  const flush = () => { for (let i = 0; i < section.length; i += perSlide) slides.push(section.slice(i, i + perSlide)); section = []; };
  for (const rawLine of lyrics.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/^\s*(?:\[\d{1,3}:[0-5]\d(?:[.:,]\d{1,3})?\]\s*)+/u, '').trim();
    if (!line || /^\[[^\[\]\r\n]{1,40}\]$/.test(line)) flush();
    else if (layout) section.push(...wrapLyricLine(line, layout.width * layout.maxTextWidth / 100, layout.fontSize));
    else section.push(line);
  }
  flush();
  return slides;
}

export async function collectSlides(input: PresentationInput, signal?: AbortSignal): Promise<Slide[]> {
  if (!Array.isArray(input.songIds) || input.songIds.length > 100) throw new Error('곡은 100곡 이하로 선택하세요.');
  if (input.pptxBase64) throw new Error('기존 PPTX에 추가하는 기능은 Cloudflare 전환 중입니다. 새 PPTX로 만들어 주세요.');
  const external = new Map((input.externalSongs || []).map(song => [song.id, song]));
  const songs = await Promise.all(input.songIds.map(async id => {
    const original = input.autoMelodies?.[id];
    if (original?.sourceType === 'sheet-image' && original.sheetImages?.length) {
      return { id, title: original.title, artist: null, lyrics: '' };
    }
    const supplied = external.get(id);
    if (supplied?.lyrics.trim()) return supplied;
    if (id < 0) throw new Error('선택한 곡에 가사가 없습니다.');
    let song = lyricCache.get(id);
    if (!song) {
      const response = await fetch('/song', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error('선택한 곡의 가사를 불러오지 못했습니다.');
      const result = await response.json() as { success: boolean; data: Song | null };
      if (!result.success || !result.data?.lyrics?.trim()) throw new Error('선택한 곡에 가사가 없습니다.');
      song = result.data;
      lyricCache.set(id, song);
    }
    if (!song.lyrics?.trim()) throw new Error('선택한 곡에 가사가 없습니다.');
    return { id, title: song.title, artist: song.artist, lyrics: song.lyrics };
  }));
  const layout = {
    width: input.slideSize?.width ?? 1280,
    fontSize: input.style.fontSize,
    maxTextWidth: Math.min(90, input.style.textWidth ?? 87.5),
  };
  const slideHeight = input.slideSize?.height ?? 720;
  const maxTextHeight = input.style.textHeight && input.style.textHeight !== 55.6 ? input.style.textHeight : 80;
  const lineHeight = input.style.fontSize * 96 / 72 * 1.2;
  const fittingLines = Math.max(1, Math.floor(slideHeight * maxTextHeight / 100 / lineHeight));
  const safeLinesPerSlide = Math.min(input.style.linesPerSlide, fittingLines);
  const slides = songs.flatMap(song => {
    const original = input.autoMelodies?.[song.id];
    if (original?.sourceType === 'sheet-image' && original.sheetImages?.length) {
      return original.sheetImages.map(scorePageImage => ({ title: song.title, lines: [], scorePageImage }));
    }
    return splitLyrics(song.lyrics, safeLinesPerSlide, layout).map(lines => ({ title: song.title, lines }));
  });
  const extraSlides = Math.max(0, Math.min(100, Math.floor(input.extraSlides ?? 0)));
  if (!slides.length) slides.push({ title: '', lines: [] });
  slides.push(...Array.from({ length: extraSlides }, () => ({ title: '', lines: [] })));
  const removed = new Set((input.removedSlideIndexes ?? []).filter(index => Number.isInteger(index) && index >= 0));
  const visibleSlides = slides.filter((_, index) => !removed.has(index));
  const orderedVisibleSlides = normalizeSlideOrder(input.slideOrder, visibleSlides.length).map(index => visibleSlides[index]);
  const result = orderedVisibleSlides.length ? orderedVisibleSlides : [{ title: '', lines: [] }];
  return result.map((slide, index) => {
    const color = input.slideTextColors?.[index] ?? input.style.textColor;
    const longestLine = Math.max(1, ...slide.lines.map(line => [...line].length));
    const width = Math.max(18, Math.min(90, longestLine * ((input.style.fontSize ?? 40) / 960) * 100 + 3));
    const aspect = (input.slideSize?.height ?? 720) / (input.slideSize?.width ?? 1280);
    const height = Math.max(12, Math.min(80, slide.lines.length * (input.style.fontSize / 960) * 120 / aspect + 3));
    return { ...slide, lines: input.slideTextOverrides?.[index] !== undefined ? input.slideTextOverrides[index].split(/\r\n|\r|\n/) : slide.lines, textPosition: input.slidePositions?.[index] ?? { x: input.style.textX ?? 50, y: input.style.textY ?? 50, width: input.style.textWidth === 87.5 ? width : input.style.textWidth ?? width, height: input.style.textHeight === 55.6 ? height : input.style.textHeight ?? height }, textColor: color };
  });
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
    if (item.scorePageImage) {
      const imageWidth = Math.min(size.width, size.height * 16 / 9);
      const imageHeight = imageWidth * 9 / 16;
      slide.addImage({ data: item.scorePageImage, x: (size.width - imageWidth) / 192,
        y: (size.height - imageHeight) / 192, w: imageWidth / 96, h: imageHeight / 96 });
      continue;
    }
    const position = item.textPosition ?? { x: style.textX ?? 50, y: style.textY ?? 50, width: style.textWidth ?? 87.5, height: style.textHeight ?? 55.6 };
    const textWidth = size.width * position.width / 100;
    const textHeight = size.height * position.height / 100;
    const textX = size.width * position.x / 100 - textWidth / 2;
    const textY = size.height * position.y / 100 - textHeight / 2;
    slide.addText(item.lines.join('\n'), { x: textX/96, y: textY/96, w: textWidth/96, h: textHeight/96,
      fontFace: style.fontFamily, fontSize: style.fontSize, color: (item.textColor ?? style.textColor).replace('#', ''),
      bold: style.bold, align: alignment[style.alignment], valign: 'middle', margin: 0 });
  }
  const data = await ppt.write({ outputType: 'blob' });
  if (!(data instanceof Blob)) throw new Error('PPTX를 생성하지 못했습니다.');
  return data;
}

export async function renderSlide(_slide: Slide, style: SlideStyle, width = 1280, size = {width:1280,height:720}): Promise<string> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.round(width * size.height / size.width);
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('미리보기를 만들 수 없습니다.');
  ctx.scale(canvas.width / size.width, canvas.height / size.height);
  ctx.fillStyle = style.backgroundColor; ctx.fillRect(0, 0, size.width, size.height);
  if (style.backgroundImageBase64 && style.backgroundImageType) {
    const image = new Image(); image.src = `data:image/${style.backgroundImageType === 'PNG' ? 'png' : 'jpeg'};base64,${style.backgroundImageBase64}`;
    await image.decode(); ctx.drawImage(image, 0, 0, size.width, size.height);
  }
  if (_slide.scorePageImage) {
    const image = new Image(); image.src = _slide.scorePageImage;
    await image.decode();
    const scale = Math.min(size.width / image.naturalWidth, size.height / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    ctx.drawImage(image, (size.width-w)/2, (size.height-h)/2, w, h);
  }
  return canvas.toDataURL('image/png').split(',')[1];
}
