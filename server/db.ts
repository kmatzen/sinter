import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'modeler.db'));

db.pragma('journal_mode = WAL');

// Core tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    avatar_url TEXT,
    provider TEXT,
    provider_id TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    name TEXT DEFAULT 'Untitled',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
`);

// Migrations — add columns that were introduced after initial schema.
// SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check the schema.
function columnExists(table: string, column: string): boolean {
  const info = db.pragma(`table_info(${table})`) as { name: string }[];
  return info.some((col) => col.name === column);
}

if (!columnExists('projects', 'share_token')) {
  db.exec('ALTER TABLE projects ADD COLUMN share_token TEXT');
}
if (!columnExists('users', 'stripe_customer_id')) {
  db.exec('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT');
}
if (!columnExists('users', 'plan')) {
  db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'");
}
if (!columnExists('users', 'llm_requests_this_month')) {
  db.exec('ALTER TABLE users ADD COLUMN llm_requests_this_month INTEGER DEFAULT 0');
}
if (!columnExists('users', 'llm_requests_reset_at')) {
  db.exec('ALTER TABLE users ADD COLUMN llm_requests_reset_at TEXT');
}
if (!columnExists('users', 'credits')) {
  db.exec('ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 0');
}
if (!columnExists('users', 'storage_mb')) {
  db.exec('ALTER TABLE users ADD COLUMN storage_mb INTEGER DEFAULT 0');
}
if (!columnExists('users', 'storage_charged_at')) {
  db.exec('ALTER TABLE users ADD COLUMN storage_charged_at TEXT');
}
if (!columnExists('users', 'storage_allocation_mb')) {
  db.exec('ALTER TABLE users ADD COLUMN storage_allocation_mb INTEGER DEFAULT 0');
}
if (!columnExists('users', 'storage_expires_at')) {
  db.exec('ALTER TABLE users ADD COLUMN storage_expires_at TEXT');
}
if (!columnExists('users', 'grace_period_start')) {
  db.exec('ALTER TABLE users ADD COLUMN grace_period_start TEXT');
}

if (!columnExists('users', 'credits_expire_at')) {
  db.exec('ALTER TABLE users ADD COLUMN credits_expire_at TEXT');
}

if (!columnExists('projects', 'thumbnail')) {
  db.exec('ALTER TABLE projects ADD COLUMN thumbnail TEXT');
}

// OAuth token storage for external storage providers
if (!columnExists('users', 'oauth_access_token')) {
  db.exec('ALTER TABLE users ADD COLUMN oauth_access_token TEXT');
}
if (!columnExists('users', 'oauth_refresh_token')) {
  db.exec('ALTER TABLE users ADD COLUMN oauth_refresh_token TEXT');
}
if (!columnExists('users', 'oauth_token_expires_at')) {
  db.exec('ALTER TABLE users ADD COLUMN oauth_token_expires_at TEXT');
}

// External storage references for projects
if (!columnExists('projects', 'storage_provider')) {
  db.exec('ALTER TABLE projects ADD COLUMN storage_provider TEXT');
}
if (!columnExists('projects', 'storage_external_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN storage_external_id TEXT');
}

db.exec('CREATE TABLE IF NOT EXISTS used_sessions (key TEXT PRIMARY KEY)');

export default db;
