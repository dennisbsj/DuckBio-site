/**
 * A single identity SQLite file's durable native-link audit schema marker.
 * Must run inside the SAME BEGIN IMMEDIATE transaction as the first seed.
 * The SQLite header marker is independent of the legacy grant user_version.
 * Losing this audit resets AUTOINCREMENT IDs and could resurrect old proofs.
 */
import {DatabaseSync} from 'node:sqlite';

export const IDENTITY_NATIVE_AUDIT_APPLICATION_ID = 0x4455434b; // "DUCK"
const exists = (db,name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
).get(name));

export function ensureNativeOrganizationAuditSchema(db) {
  if (!(db instanceof DatabaseSync) || db.isTransaction !== true)
    throw Error('native_link_schema_write_lock_required');
  const marker = db.prepare('PRAGMA application_id').get()?.application_id;
  if (marker !== 0 && marker !== IDENTITY_NATIVE_AUDIT_APPLICATION_ID)
    throw Error('invalid_native_link_revision');
  const links = exists(db,'suite_identity_org_native_links');
  const audit = exists(db,'suite_identity_org_native_audit');
  // A newer initialized identity DB must NEVER silently recreate either
  // table. Even a legacy unmarked DB with half a schema is unsafe to seed.
  if ((marker !== 0 && (!links || !audit)) || (links !== audit))
    throw Error('invalid_native_link_revision');
  db.exec(`
    CREATE TABLE IF NOT EXISTS suite_identity_org_native_links (
      user_id TEXT NOT NULL REFERENCES suite_identity_users(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL,
      workspace_org_id TEXT NOT NULL,
      native_user_id TEXT NOT NULL,
      native_org_id TEXT NOT NULL,
      verified_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,app_id,workspace_org_id),
      UNIQUE(app_id,native_user_id)
    );
    CREATE INDEX IF NOT EXISTS suite_identity_org_native_by_org
      ON suite_identity_org_native_links(app_id,workspace_org_id,native_org_id);
    CREATE INDEX IF NOT EXISTS suite_identity_org_native_by_native_tenant
      ON suite_identity_org_native_links(app_id,native_org_id,workspace_org_id);
    CREATE TABLE IF NOT EXISTS suite_identity_org_native_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      app_id TEXT NOT NULL,
      workspace_org_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('link.bound','link.migrated','link.revoked')),
      recorded_at INTEGER NOT NULL
    );
  `);
  if (marker === 0)
    db.exec(`PRAGMA application_id=${IDENTITY_NATIVE_AUDIT_APPLICATION_ID}`);
}
