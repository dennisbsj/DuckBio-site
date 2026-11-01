import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

// All tables belong to shared authentication, in a separate private database.
// It must never be a business-data database or a file under public_html.
export function createSqliteAuthStores({ databasePath, clock = Date.now }) {
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath) || databasePath.split(path.sep).includes('public_html')) throw new Error('An absolute private auth database path is required');
  mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  if (realpathSync(path.dirname(databasePath)).split(path.sep).includes('public_html') || (existsSync(databasePath) && realpathSync(databasePath).split(path.sep).includes('public_html'))) throw new Error('An absolute private auth database path is required');
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS suite_auth_records (
      kind TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      value TEXT NOT NULL CHECK(json_valid(value)),
      expires_at INTEGER NOT NULL,
      PRIMARY KEY(kind,key_hash)
    );
    CREATE INDEX IF NOT EXISTS suite_auth_records_expiry ON suite_auth_records(expires_at);
    CREATE TABLE IF NOT EXISTS suite_auth_attempts (
      key_hash TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  function privateFiles() {
    for (const suffix of ['', '-wal', '-shm']) {
      try { chmodSync(databasePath + suffix, 0o600); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  privateFiles();
  const save = db.prepare('INSERT INTO suite_auth_records(kind,key_hash,value,expires_at) VALUES(?,?,?,?) ON CONFLICT(kind,key_hash) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at');
  const read = db.prepare('SELECT value FROM suite_auth_records WHERE kind=? AND key_hash=? AND expires_at>?');
  const remove = db.prepare('DELETE FROM suite_auth_records WHERE kind=? AND key_hash=?');
  const take = db.prepare('DELETE FROM suite_auth_records WHERE kind=? AND key_hash=? RETURNING value,expires_at');
  const consume = db.prepare(`DELETE FROM suite_auth_records
    WHERE kind='code' AND key_hash=? AND expires_at>?
      AND json_extract(value,'$.clientId')=? AND json_extract(value,'$.state')=?
      AND json_extract(value,'$.challenge')=? AND json_extract(value,'$.redirectUri')=?
    RETURNING value`);
  const attempt = db.prepare(`INSERT INTO suite_auth_attempts(key_hash,attempts,expires_at) VALUES(?,1,?)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts=CASE WHEN suite_auth_attempts.expires_at<=? THEN 1 ELSE suite_auth_attempts.attempts+1 END,
      expires_at=CASE WHEN suite_auth_attempts.expires_at<=? THEN excluded.expires_at ELSE suite_auth_attempts.expires_at END
    RETURNING attempts`);
  let nextCleanup = 0;
  function cleanup() {
    const now = clock();
    if (now < nextCleanup) return;
    db.prepare('DELETE FROM suite_auth_records WHERE expires_at<=?').run(now);
    db.prepare('DELETE FROM suite_auth_attempts WHERE expires_at<=?').run(now);
    nextCleanup = now + 5 * 60_000;
  }
  function put(kind, key, value) {
    if (typeof key !== 'string' || !key || !value || !Number.isFinite(value.expiresAt)) throw new Error('Invalid authentication storage record');
    cleanup();
    save.run(kind, key, JSON.stringify(value), value.expiresAt); privateFiles();
  }
  function get(kind, key) { const row = read.get(kind, key, clock()); return row ? JSON.parse(row.value) : null; }
  function atomicTake(kind, key) { const row = take.get(kind, key); return row && row.expires_at > clock() ? JSON.parse(row.value) : null; }
  return Object.freeze({
    brokerStore: Object.freeze({
      async putCsrf(key, value) { put('csrf', key, value); },
      async getCsrf(key) { return get('csrf', key); },
      async putCode(key, value) { put('code', key, value); },
      async consumeCode(key, expected) {
        const row = consume.get(key, expected.now, expected.clientId, expected.state, expected.challenge, expected.redirectUri);
        return row ? JSON.parse(row.value) : null;
      },
      async putProof(key, value) { put('proof', key, value); },
      async getProof(key) { return get('proof', key); },
      async deleteProof(key) { remove.run('proof', key); },
      async consumeLoginAttempt(key, { limit, windowMs, now }) {
        if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1 || !Number.isFinite(now)) throw new Error('Invalid authentication rate limit');
        cleanup();
        const row = attempt.get(key, now + windowMs, now, now);
        privateFiles();
        return row.attempts <= limit;
      },
      async clearLoginAttempts(key) { db.prepare('DELETE FROM suite_auth_attempts WHERE key_hash=?').run(key); },
    }),
    gatewayStore: Object.freeze({
      async putTransaction(key, value) { put('transaction', key, value); },
      async takeTransaction(key) { return atomicTake('transaction', key); },
      async putSession(key, value) { put('gateway-session', key, value); },
      async getSession(key) { return get('gateway-session', key); },
      async deleteSession(key) { remove.run('gateway-session', key); },
    }),
    close() { db.close(); },
  });
}
