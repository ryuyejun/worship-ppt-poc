import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createPpt } from './src/ppt.js';

initializeApp();

// Firebase Authentication must be configured before this endpoint is usable.
export const createPresentation = onRequest({ region: 'asia-northeast3', timeoutSeconds: 60, memory: '512MiB' }, async (request, response) => {
  if (request.method !== 'POST') { response.status(405).end(); return; }
  const match = /^Bearer (.+)$/.exec(request.get('Authorization') || '');
  if (!match) { response.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  try { await getAuth().verifyIdToken(match[1]); }
  catch { response.status(401).json({ error: '로그인을 확인해 주세요.' }); return; }
  try {
    const ids = request.body?.songIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !/^[1-9]\d*$/.test(String(id)))) {
      response.status(400).json({ error: '곡을 1~100개 선택해 주세요.' }); return;
    }
    if (request.body?.pptxBase64) {
      response.status(400).json({ error: '기존 PPTX에 추가하는 기능은 아직 지원하지 않습니다.' }); return;
    }
    const docs = await Promise.all(ids.map(id => getFirestore().collection('songs').doc(String(id)).get()));
    if (docs.some(doc => !doc.exists)) { response.status(404).json({ error: '곡을 찾지 못했습니다.' }); return; }
    const data = await createPpt(docs.map(doc => doc.data()), request.body?.style);
    response.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    response.set('Content-Disposition', 'attachment; filename="worship.pptx"');
    response.send(data);
  } catch {
    response.status(500).json({ error: 'PPT를 만들지 못했습니다.' });
  }
});
