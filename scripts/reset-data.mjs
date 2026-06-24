import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(rootDir, '.data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'app.sqlite');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN');

for (const table of [
  'settlement_results',
  'multipliers',
  'investments',
  'membership_users',
  'memberships',
  'sessions',
  'group_accounts',
  'admins'
]) {
  db.prepare(`DELETE FROM ${table}`).run();
}

db.prepare(`
  DELETE FROM sqlite_sequence
  WHERE name IN ('settlement_results','multipliers','investments','membership_users','memberships','sessions','group_accounts','admins')
`).run();

db.prepare('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)').run(
  process.env.ADMIN_USERNAME || 'admin',
  bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10),
  process.env.ADMIN_DISPLAY_NAME || '主办方'
);

db.exec('COMMIT');
db.close();

console.log(`Reset ${dbPath}`);
console.log(`Seeded admin: ${process.env.ADMIN_USERNAME || 'admin'} / ${process.env.ADMIN_PASSWORD || 'admin123'}`);
