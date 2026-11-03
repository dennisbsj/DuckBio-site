/**
 * DORMANT Workspace-side scoped native identity links for the six original apps.
 *
 * This store is separate from the legacy (user, app) identity grants currently
 * consumed by the six-app broker. It never imports, infers or activates them.
 * No HTTP endpoint, SSO grant, license or native permission is issued here.
 */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

const APPS = new Set(['goflo', 'eel', 'methpipe', 'mantrain', 'duckman', 'limsman']);
const safe = value => typeof value === 'string' &&
  /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export class ScopedNativeLinkError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new ScopedNativeLinkError(code); };
const table = 'suite_identity_scoped_native_links';

export function createWorkspaceScopedNativeLinks({
  databasePath, clock = Date.now, verifyNativeOwnership
} = {}) {
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath) ||
      databasePath.split(path.sep).includes('public_html'))
    throw Error('private_scoped_link_database_required');
  if (typeof clock !== 'function' ||
      typeof verifyNativeOwnership !== 'function')
    throw Error('private_native_ownership_verifier_required');
  mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const parent = realpathSync(path.dirname(databasePath));
  if (parent.split(path.sep).includes('public_html') ||
      (existsSync(databasePath) &&
       realpathSync(databasePath).split(path.sep).includes('public_html')))
    throw Error('private_scoped_link_database_required');

  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS suite_identity_scoped_native_links (
      workspace_user_id TEXT NOT NULL,
      workspace_organization_id TEXT NOT NULL,
      app_id TEXT NOT NULL,
      native_user_id TEXT NOT NULL,
      native_organization_id TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      linked_at INTEGER NOT NULL,
      revoked_at INTEGER,
      PRIMARY KEY(workspace_user_id,workspace_organization_id,app_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS scoped_native_actor_active
      ON suite_identity_scoped_native_links(app_id,native_organization_id,native_user_id)
      WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS suite_identity_scoped_native_link_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_user_id TEXT NOT NULL,
      workspace_organization_id TEXT NOT NULL,
      app_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('link','revoke')),
      actor TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  function privateFiles() {
    for (const suffix of ['', '-wal', '-shm']) {
      try { chmodSync(databasePath + suffix, 0o600); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  privateFiles();
  function validateKey({ workspaceAccountId, workspaceOrganizationId, appId } = {}) {
    if (!safe(workspaceAccountId) || !safe(workspaceOrganizationId) ||
        !APPS.has(appId)) fail('invalid_scoped_link_key');
  }
  function key(input) {
    return [input.workspaceAccountId, input.workspaceOrganizationId, input.appId];
  }
  function read(input) {
    const row = db.prepare(`SELECT * FROM ${table}
      WHERE workspace_user_id=? AND workspace_organization_id=? AND app_id=?
        AND revoked_at IS NULL`).get(...key(input));
    return row ? Object.freeze({
      workspaceAccountId: row.workspace_user_id,
      workspaceOrganizationId: row.workspace_organization_id,
      appId: row.app_id,
      nativeUserId: row.native_user_id,
      nativeOrganizationId: row.native_organization_id,
      revision: row.revision
    }) : null;
  }
  function transact(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      privateFiles();
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function audit(input, action, actor, revision, at) {
    db.prepare(`INSERT INTO suite_identity_scoped_native_link_audit
      (workspace_user_id,workspace_organization_id,app_id,action,actor,revision,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(...key(input), action, actor, revision, at);
  }

  return Object.freeze({
    get(input = {}) {
      validateKey(input);
      return read(input);
    },
    /**
     * Private operator service ONLY. An independent native backend verifier
     * must positively confirm exact ownership; email and browser claims do
     * not qualify. The caller must additionally validate central membership,
     * current account state and tenant authorization before requesting a link.
     */
    async link(input = {}) {
      validateKey(input);
      const { nativeUserId, nativeOrganizationId, approvedBy } = input;
      if (!safe(nativeUserId) || !safe(nativeOrganizationId) || !safe(approvedBy) ||
          !own(input,'nativeUserId') || !own(input,'nativeOrganizationId'))
        fail('invalid_scoped_link');
      let verified;
      try {
        verified = (await verifyNativeOwnership({
          workspaceAccountId: input.workspaceAccountId,
          workspaceOrganizationId: input.workspaceOrganizationId,
          appId: input.appId, nativeUserId, nativeOrganizationId
        })) === true;
      } catch { fail('native_ownership_unavailable'); }
      if (!verified) fail('native_ownership_unverified');
      return transact(() => {
        const previous = db.prepare(`SELECT * FROM ${table}
          WHERE workspace_user_id=? AND workspace_organization_id=? AND app_id=?`)
          .get(...key(input));
        if (previous && previous.revoked_at === null &&
            previous.native_user_id === nativeUserId &&
            previous.native_organization_id === nativeOrganizationId)
          return read(input);
        // Do not silently change a live mapping: explicitly revoke first.
        if (previous && previous.revoked_at === null)
          fail('existing_scoped_link_requires_revocation');
        const revision = (previous?.revision ?? 0) + 1;
        const at = clock();
        try {
          db.prepare(`INSERT INTO ${table}
            (workspace_user_id,workspace_organization_id,app_id,
             native_user_id,native_organization_id,approved_by,revision,linked_at,revoked_at)
            VALUES(?,?,?,?,?,?,?,?,NULL)
            ON CONFLICT(workspace_user_id,workspace_organization_id,app_id)
            DO UPDATE SET native_user_id=excluded.native_user_id,
              native_organization_id=excluded.native_organization_id,
              approved_by=excluded.approved_by,revision=excluded.revision,
              linked_at=excluded.linked_at,revoked_at=NULL`)
            .run(...key(input),nativeUserId,nativeOrganizationId,approvedBy,revision,at);
        } catch (error) {
          if (error.code?.startsWith('ERR_SQLITE') &&
              /UNIQUE constraint failed/.test(error.message))
            fail('native_actor_already_linked');
          throw error;
        }
        audit(input, 'link', approvedBy, revision, at);
        return read(input);
      });
    },
    revoke(input = {}) {
      validateKey(input);
      if (!safe(input.approvedBy)) fail('invalid_scoped_link_actor');
      return transact(() => {
        const previous = read(input);
        if (!previous) return false;
        const at = clock();
        db.prepare(`UPDATE ${table} SET revoked_at=?,revision=?
          WHERE workspace_user_id=? AND workspace_organization_id=? AND app_id=?
            AND revoked_at IS NULL`)
          .run(at, previous.revision + 1, ...key(input));
        audit(input, 'revoke', input.approvedBy, previous.revision + 1, at);
        return true;
      });
    },
    auditFor(input = {}) {
      validateKey(input);
      return db.prepare(`SELECT action,actor,revision,created_at AS createdAt
        FROM suite_identity_scoped_native_link_audit
        WHERE workspace_user_id=? AND workspace_organization_id=? AND app_id=?
        ORDER BY id`).all(...key(input));
    },
    close() { db.close(); }
  });
}
