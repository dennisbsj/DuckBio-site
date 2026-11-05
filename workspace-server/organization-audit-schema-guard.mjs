/**
 * Fail-closed protection for monotonic organization_audit AUTOINCREMENT IDs.
 * Must run under BEGIN IMMEDIATE BEFORE CREATE TABLE IF NOT EXISTS can
 * silently reconstruct a lost audit table with recycled policy revisions.
 * Uses the existing session_organization_versions user_version marker.
 */
import {DatabaseSync} from 'node:sqlite';

export function assertOrganizationAuditSchema(db) {
  if (!(db instanceof DatabaseSync) || db.isTransaction !== true)
    throw Error('organization_audit_write_lock_required');
  const userVersion=db.prepare('PRAGMA user_version').get()?.user_version;
  if (!Number.isSafeInteger(userVersion) || userVersion<0)
    throw Error('organization_audit_unavailable');
  const has = name=>Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name));
  const audit=has('organization_audit');
  // The table was present in all previously deployed organization schemas.
  // A modern marker or historical organization table proves an established DB.
  if (!audit && (userVersion!==0 || has('organizations')))
    throw Error('organization_audit_unavailable');
}
