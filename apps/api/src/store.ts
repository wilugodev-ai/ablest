import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export type Row = Record<string, unknown>;
const directory = resolve(process.env.DATA_DIR || '../../.data');
mkdirSync(directory, { recursive: true });
export const db = new DatabaseSync(resolve(directory, 'content.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY CHECK(id=1), count INTEGER NOT NULL, start INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, features TEXT NOT NULL, status TEXT NOT NULL, url TEXT NOT NULL, published INTEGER NOT NULL, position INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, alt TEXT NOT NULL, data BLOB NOT NULL, position INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
if (!db.prepare('SELECT value FROM meta WHERE key=?').get('seeded')) {
  db.exec('BEGIN');
  try {
    const insert = db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?,?)');
    insert.run(randomUUID(), 'InTouch', 'CRM', 'Business & relationships', 'Keep customers, conversations, and the next step in focus. A CRM for independent businesses to manage relationships and daily operations in one workspace.', JSON.stringify(['Contacts, deals, and follow-ups', 'Quotes, appointments, and support tickets', 'Team workspaces and business reports']), 'In development', '', 1, 0);
    insert.run(randomUUID(), 'IterateView', 'Review. Learn. Improve.', 'Trading & personal review', 'Turn trading history into a useful review habit. Bring trades, decision notes, and performance summaries together so you can understand your process and plan your next improvement.', JSON.stringify(['Trading journal and detailed trade review', 'CSV import and execution history', 'Performance summaries and review filters']), 'In development', '', 1, 1);
    db.prepare('INSERT INTO meta VALUES (?,?)').run('seeded', '1'); db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
