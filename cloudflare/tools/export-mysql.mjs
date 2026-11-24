import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import mysql from 'mysql2/promise';

const [configPath, outputPath] = process.argv.slice(2);
if (!configPath || !outputPath) throw new Error('Usage: node tools/export-mysql.mjs <mysql.properties> <new-output.sqlite>');
const fields = {
  songs: ['id','title','normalized_title','lyricist','composer','artist','lyrics','source_url','version','lyrics_status','category','hymn_number'],
  song_aliases: ['id','song_id','alias','normalized_alias'],
  song_requests: ['id','title','normalized_title','lyricist','normalized_lyricist','status','request_count','created_at','updated_at','song_id'],
};
const properties = Object.fromEntries(fs.readFileSync(configPath, 'utf8').split(/\r?\n/)
  .map(line => line.match(/^\s*(url|user|username|password)\s*=\s*(.*)$/)).filter(Boolean).map(match => [match[1], match[2]]));
const url = new URL(properties.url.replace(/^jdbc:/, ''));
if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Only local MySQL is supported');
const connection = await mysql.createConnection({host: url.hostname, port: Number(url.port || 3306), database: url.pathname.slice(1), user: properties.user || properties.username, password: properties.password, charset: 'utf8mb4', dateStrings: true});
let db;
let created = false;
try {
  fs.closeSync(fs.openSync(outputPath, 'wx', 0o600));
  created = true;
  db = new DatabaseSync(outputPath);
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  await connection.query('SET TRANSACTION READ ONLY');
  await connection.beginTransaction();
  db.exec('BEGIN');
  for (const [table, columns] of Object.entries(fields)) {
    const [rows] = await connection.query(`SELECT ${columns.map(c => `\`${c}\``).join(',')} FROM \`${table}\` ORDER BY id`);
    const insert = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
    for (const row of rows) insert.run(...columns.map(c => row[c] ?? null));
    const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    if (count !== rows.length) throw new Error(`${table}: count mismatch`);
    if (table === 'songs') {
      const lookup = db.prepare('SELECT lyrics, title FROM songs WHERE id = ?');
      for (const row of rows) {
        const saved = lookup.get(row.id);
        if (saved.lyrics !== row.lyrics || saved.title !== row.title) throw new Error(`Song ${row.id}: mismatch`);
      }
      console.log(`${table}: ${count} records; ${rows.filter(row => typeof row.lyrics === 'string' && row.lyrics.trim()).length} contain lyrics`);
    } else console.log(`${table}: ${count} records`);
  }
  db.exec('COMMIT');
  await connection.commit();
} catch (error) {
  try { db?.exec('ROLLBACK'); } catch {}
  try { await connection.rollback(); } catch {}
  db?.close(); db = undefined;
  if (created) fs.rmSync(outputPath, { force: true });
  throw error;
} finally {
  db?.close();
  await connection.end();
}
