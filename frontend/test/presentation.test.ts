import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { splitLyrics, collectSlides, makePresentation, type PresentationInput } from '../src/presentation';

const style = { backgroundColor:'#16233a', textColor:'#ffffff', fontFamily:'Arial', fontSize:40, alignment:'CENTER' as const, linesPerSlide:2, bold:false };
test('절과 후렴 및 줄바꿈을 보존해 PPTX를 생성한다', async () => {
  const before=globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const input=JSON.parse(String(options?.body)) as {id:number};
    return Response.json({success:true,data:{ id:input.id,title:'테스트',artist:null,lyrics:'[1절]\n첫째 줄\n둘째 줄\n셋째 줄\n\n[후렴]\n넷째 줄' }});
  };
  try {
    assert.deepEqual(splitLyrics('[1절]\n첫째 줄\n둘째 줄\n셋째 줄\n\n[후렴]\n넷째 줄',2), [['첫째 줄','둘째 줄'],['셋째 줄'],['넷째 줄']]);
    const input: PresentationInput = {songIds:[1],style};
    const slides=await collectSlides(input); assert.equal(slides.length,3);
    const blob=await makePresentation(slides,style); const zip=await JSZip.loadAsync(await blob.arrayBuffer());
    const slideNames=Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));
    assert.equal(slideNames.length,3);
    const first=await zip.file('ppt/slides/slide1.xml')!.async('string');
    assert.match(first,/첫째 줄/); assert.match(first,/둘째 줄/);
    await assert.rejects(collectSlides({...input,pptxBase64:'invalid'}),/전환 중/);
  } finally {globalThis.fetch=before;}
});

test('악보 이미지를 표시하지 못해도 전체 가사 페이지를 유지한다', async () => {
  const before=globalThis.fetch;
  globalThis.fetch=async (url) => String(url).includes('/musicxml')
    ? new Response('',{status:502})
    : Response.json({success:true,data:{id:2,title:'테스트',artist:null,lyrics:'첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄'}});
  try {
    const slides=await collectSlides({songIds:[2],style,autoMelodies:{2:{title:'테스트',sourceType:'sheet-omr',musicxmlUrl:'/missing/musicxml',bpm:100,vocalStartSec:0,vocalEndSec:5,notes:[],jobId:'test',revision:1,reviewed:false}}});
    assert.equal(slides.length,3);
    assert.deepEqual(slides.flatMap(slide=>slide.lines),['첫째 줄','둘째 줄','셋째 줄','넷째 줄','다섯째 줄']);
  } finally {globalThis.fetch=before;}
});

test('원본 PPT가 있으면 가사 DB 없이 모든 페이지를 그대로 사용한다', async () => {
  const image='data:image/png;base64,aGVsbG8=';
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('가사 API를 호출하면 안 됩니다.'); };
  try {
    const original = { title: '원본', sourceType: 'sheet-image', sheetImages: [image, image],
      bpm: 100, vocalStartSec: 0, vocalEndSec: 0, notes: [], jobId: 'image', revision: 1, reviewed: false };
    for (const id of [-3, 3]) {
      const slides = await collectSlides({ songIds: [id], style, autoMelodies: { [id]: original } });
      assert.equal(slides.length, 2);
      assert.ok(slides.every(slide => slide.scorePageImage === image && slide.lines.length === 0 && !slide.scoreRows));
    }
  } finally {
    globalThis.fetch = before;
  }
});
