// Import is deliberately restricted to a local demo emulator, never a cloud project.
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mapRows } from './migration.js';

if (!/^((127\.0\.0\.1|localhost):\d+)$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^demo-[a-z0-9-]+$/.test(process.env.GCLOUD_PROJECT || '')) {
  throw new Error('Local Firestore emulator and demo- project ID are required.');
}
const file = process.argv[2];
if (!file) throw new Error('MySQL properties file path is required.');
const properties = Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
  .map(line => line.match(/^\s*(url|user|username|password)\s*=\s*(.*)$/)).filter(Boolean).map(match => [match[1], match[2]]));
const parsed = new URL(properties.url.replace(/^jdbc:/, ''));
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('Only local MySQL is supported.');
const connection = await mysql.createConnection({ host: parsed.hostname, port: Number(parsed.port || 3306),
  database: parsed.pathname.slice(1), user: properties.user || properties.username, password: properties.password,
  charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true });
try {
  await connection.query('SET TRANSACTION READ ONLY');
  await connection.beginTransaction();
  initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  for (const name of ['songs', 'song_aliases', 'song_requests']) {
    const [rows] = await connection.query(`SELECT * FROM \`${name}\``);
    const mapped = mapRows(rows);
    for (let offset = 0; offset < mapped.length; offset += 200) {
      const batch = db.batch();
      for (const row of mapped.slice(offset, offset + 200)) batch.create(db.collection(name).doc(row.id), row.data);
      await batch.commit();
    }
    const count = (await db.collection(name).count().get()).data().count;
    if (count !== rows.length) throw new Error(`${name}: count mismatch`);
    if (name === 'songs') {
      let lyricsCount = 0;
      for (const row of mapped) {
        const copy = (await db.collection(name).doc(row.id).get()).data();
        if (copy.lyrics !== row.data.lyrics || copy.title !== row.data.title || copy.permission_status !== row.data.permission_status)
          throw new Error(`song ${row.id}: data mismatch`);
        if (typeof row.data.lyrics === 'string' && row.data.lyrics.trim()) lyricsCount++;
      }
      console.log(`songs: ${lyricsCount} lyrics verified, titles and permission status match`);
    }
    console.log(`${name}: MySQL ${rows.length}, Firestore emulator ${count}`);
  }
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally { await connection.end(); }
