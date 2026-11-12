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
