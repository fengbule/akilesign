import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'akile-checkin.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      token_ciphertext TEXT NOT NULL,
      token_iv TEXT NOT NULL,
      token_tag TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'new',
      auth_status TEXT NOT NULL DEFAULT 'unknown',
      last_message TEXT NOT NULL DEFAULT '',
      coin_total INTEGER,
      token_expires_at TEXT,
      last_validated_at TEXT,
      last_run_at TEXT,
      last_success_at TEXT,
      attempt_date TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_account_id ON logs(account_id, id DESC);
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(accounts)').all().map(column => column.name));
  if (!columns.has('auth_status')) db.exec("ALTER TABLE accounts ADD COLUMN auth_status TEXT NOT NULL DEFAULT 'unknown'");
  if (!columns.has('token_expires_at')) db.exec('ALTER TABLE accounts ADD COLUMN token_expires_at TEXT');
  if (!columns.has('last_validated_at')) db.exec('ALTER TABLE accounts ADD COLUMN last_validated_at TEXT');
  return db;
}

export function publicAccount(row) {
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    enabled: Boolean(row.enabled),
    status: row.status,
    authStatus: row.auth_status,
    lastMessage: row.last_message,
    coinTotal: row.coin_total,
    tokenExpiresAt: row.token_expires_at,
    lastValidatedAt: row.last_validated_at,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
