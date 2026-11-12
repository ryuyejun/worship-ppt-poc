import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node tools/sqlite-to-d1.mjs <backup.sqlite> <new-output.sql>');
if (!fs.statSync(source).isFile()) throw new Error('Source must be an existing file');
const db = new DatabaseSync(source, { readOnly: true });
const tables = ['songs', 'song_aliases', 'song_requests'];
const quoteName = name => `"${name.replaceAll('"', '""')}"`;
const literal = value => {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return `CAST(X'${Buffer.from(value, 'utf8').toString('hex')}' AS TEXT)`;
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  throw new Error('Unsupported SQLite value');
};
let fd;
let created = false;
try {
  fd = fs.openSync(destination, 'wx', 0o600);
  created = true;
  for (const table of tables) {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!schema?.sql) throw new Error(`Missing table: ${table}`);
    fs.writeSync(fd, `${schema.sql};\n`);
    const columns = db.prepare(`PRAGMA table_info(${quoteName(table)})`).all().map(column => column.name);
    const columnNames = columns.map(quoteName).join(',');
    for (const row of db.prepare(`SELECT * FROM ${quoteName(table)} ORDER BY id`).iterate()) {
      fs.writeSync(fd, `INSERT INTO ${quoteName(table)} (${columnNames}) VALUES (${columns.map(column => literal(row[column])).join(',')});\n`);
    }
  }
  for (const index of db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").iterate()) {
    fs.writeSync(fd, `${index.sql};\n`);
  }
  console.log('Created a SQL import file. Import only into a new, empty test database.');
} catch (error) {
  if (fd !== undefined) { fs.closeSync(fd); fd = undefined; }
  if (created) fs.unlinkSync(destination);
  throw error;
} finally {
  if (fd !== undefined) fs.closeSync(fd);
  db.close();
}
