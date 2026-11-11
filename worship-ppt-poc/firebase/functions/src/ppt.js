import pptxgen from 'pptxgenjs';

/** Preserve the existing blank-line and section-label boundaries. */
export function splitLyrics(text, linesPerSlide = 2) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('가사가 없습니다.');
  if (!Number.isInteger(linesPerSlide) || linesPerSlide < 1 || linesPerSlide > 6) throw new Error('슬라이드 줄 수는 1~6이어야 합니다.');
  const slides = [];
  let section = [];
  const flush = () => {
    for (let i = 0; i < section.length; i += linesPerSlide) slides.push(section.slice(i, i + linesPerSlide));
    section = [];
  };
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.trim() || /^\[[^\[\]\r\n]{1,40}\]$/.test(line.trim())) flush();
    else section.push(line);
  }
  flush();
  return slides;
}

export async function createPpt(songs, style = {}) {
  if (!Array.isArray(songs) || !songs.length || songs.length > 100) throw new Error('곡을 1곡 이상 100곡 이하로 선택하세요.');
  const ppt = new pptxgen();
  ppt.layout = 'LAYOUT_WIDE';
  const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? '') ? value.slice(1) : fallback;
  const background = hex(style.backgroundColor, '16233A');
  const color = hex(style.textColor, 'FFFFFF');
  const fontSize = Number.isInteger(style.fontSize) && style.fontSize >= 16 && style.fontSize <= 100 ? style.fontSize : 40;
  const alignment = { LEFT: 'left', CENTER: 'center', RIGHT: 'right' }[style.alignment] ?? 'center';
  for (const song of songs) {
    for (const lines of splitLyrics(song.lyrics, style.linesPerSlide ?? 2)) {
      const slide = ppt.addSlide();
      slide.background = { color: background };
      slide.addText(lines.join('\n'), { x: 0.8333, y: 1.6667, w: 11.6667, h: 4.1667,
        fontFace: style.fontFamily || 'Apple SD Gothic Neo', fontSize, color,
        bold: Boolean(style.bold), align: alignment, valign: 'mid', margin: 0 });
    }
  }
  return Buffer.from(await ppt.write({ outputType: 'nodebuffer' }));
}
