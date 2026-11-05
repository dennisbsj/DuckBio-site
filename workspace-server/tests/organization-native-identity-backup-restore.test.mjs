/**
 * Workspace migration backup acceptance rehearsal using synthetic SQLite only.
 *
 * Exercises a consistent SQLite VACUUM INTO snapshot; unlike copying a live
 * *.sqlite file, this operation includes the committed database state even
 * while the source uses WAL. Not a production backup utility or rollout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync, mkdirSync, copyFileSync, rmSync, chmodSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { createIdentityStore } from '../shared-auth/identity-store.mjs';

const PASSWORD = 'synthetic-only-private-snapshot-test-password';
const CLOCK = 1800000000000;
const createConfig = databasePath => ({
  databasePath, clock: () => CLOCK,
  orgNativeLinks: {
    // Test-only trust callbacks. Real operators and native services MUST
    // supply separate independently reviewed authorization and ownership.
    authorizeMutation: async () => true,
    verifyNativeOwnership: async () => true,
  },
});
function snapshot(source, destination) {
  const db = new DatabaseSync(source);
  try {
    // VACUUM INTO must not overwrite an existing snapshot file.
    db.prepare('VACUUM INTO ?').run(destination);
  } finally {
    db.close();
  }
  const check = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { check.close(); }
}
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'duckbio-native-backup-'));
  const primary = path.join(root, 'private', 'identity.sqlite');
  const backup = path.join(root, 'backups', 'before-revoke.sqlite');
  const afterBackup = path.join(root, 'backups', 'after-revoke.sqlite');
  const restored = path.join(root, 'restored', 'identity.sqlite');
  mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(restored), { recursive: true, mode: 0o700 });
  const opened = [];
  const open = databasePath => {
    const store = createIdentityStore(createConfig(databasePath));
    opened.push(store);
    return store;
  };
  const source = open(primary);
  t.after(() => {
    for (const store of opened.reverse()) store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { source, primary, backup, afterBackup, restored, open };
}
async function seed(store) {
  const actorId = randomUUID();
  const account = await store.createUser({
    email: 'backup-user@example.test',
    displayName: 'Backup user',
    password: PASSWORD,
  });
  const session = store.createSession(account.id);
  store.grantAppAccess({
    userId: account.id, appId: 'goflo',
    localUserId: 'legacy-actor', organizationId: 'legacy-native-org',
  });
  const alpha = {
    actorId, userId: account.id, appId: 'goflo',
    workspaceOrganizationId: 'lab-alpha',
    nativeUserId: 'alpha-native-user',
    nativeOrganizationId: 'alpha-native-org',
  };
  const beta = {
    ...alpha, workspaceOrganizationId: 'lab-beta',
    nativeUserId: 'beta-native-user',
    nativeOrganizationId: 'beta-native-org',
  };
  await store.bindVerifiedOrganizationNativeLink(alpha);
  await store.bindVerifiedOrganizationNativeLink(beta);
  return { actorId, account, session, alpha, beta };
}
function readLink(store, input) {
  return store.getOrganizationNativeLink({
    userId: input.userId, appId: input.appId,
    workspaceOrganizationId: input.workspaceOrganizationId,
  });
}
function restore(snapshotPath, restorePath) {
  copyFileSync(snapshotPath, restorePath);
  chmodSync(restorePath, 0o600);
}

test('consistent private SQLite snapshot restores legacy session, grants and two scoped native identities', async t => {
  const f = fixture(t), data = await seed(f.source);
  assert.throws(() => f.source.exportPortable({ includePasswordHashes: true }),
    /org_native_links_require_database_backup/);
  snapshot(f.primary, f.backup);
  // The restored SQLite file is independent from the original source.
  restore(f.backup, f.restored);
  const cloned = f.open(f.restored);
  assert.equal(cloned.getUser(data.account.id)?.state, 'active');
  assert.equal(cloned.getParentSession(data.session.parent.id)?.subject, data.account.id);
  assert.equal(cloned.getAccess(data.account.id, 'goflo')?.localIdentity.userId, 'legacy-actor');
  assert.equal(readLink(cloned, data.alpha)?.nativeUserId, 'alpha-native-user');
  assert.equal(readLink(cloned, data.beta)?.nativeOrganizationId, 'beta-native-org');
  assert.equal(cloned.orgNativeLinkAudit({
    appId: 'goflo', workspaceOrganizationId: 'lab-alpha',
  }).length, 1);
  assert.equal(cloned.orgNativeLinkAudit({
    appId: 'goflo', workspaceOrganizationId: 'lab-beta',
  }).length, 1);
  // New native identity links never grant a license or turn into a login.
  for (const input of [data.alpha, data.beta]) {
    const link = readLink(cloned, input);
    assert.equal(link.accessGranted, false);
    assert.equal(link.licensesGranted, false);
    assert.equal(link.loginEnabled, false);
  }
});

test('snapshot before/after revocation restores only the recorded state; legacy grant unchanged', async t => {
  const f = fixture(t), data = await seed(f.source);
  snapshot(f.primary, f.backup);
  const result = await f.source.revokeVerifiedOrganizationNativeLink({
    actorId: data.actorId, userId: data.account.id,
    appId: 'goflo', workspaceOrganizationId: 'lab-alpha',
  });
  assert.equal(result.applied, true);
  snapshot(f.primary, f.afterBackup);
  restore(f.afterBackup, f.restored);
  const revived = f.open(f.restored);
  assert.equal(readLink(revived, data.alpha), null);
  assert.equal(readLink(revived, data.beta)?.nativeUserId, 'beta-native-user');
  assert.deepEqual(revived.orgNativeLinkAudit({
    appId: 'goflo', workspaceOrganizationId: 'lab-alpha',
  }).map(entry => entry.action), ['link.revoked', 'link.bound']);
  assert.equal(revived.getAccess(data.account.id, 'goflo')?.localIdentity.userId,
    'legacy-actor');
  // Earlier snapshot remains immutable and still contains the old alpha link.
  const earlierPath = path.join(path.dirname(f.restored), 'earlier.sqlite');
  restore(f.backup, earlierPath);
  const earlier = f.open(earlierPath);
  assert.equal(readLink(earlier, data.alpha)?.nativeUserId, 'alpha-native-user');
  assert.equal(readLink(earlier, data.beta)?.nativeUserId, 'beta-native-user');
});

test('SQLite snapshot is an immutable destination and is not silently overwritten', async t => {
  const f = fixture(t);
  await seed(f.source);
  snapshot(f.primary, f.backup);
  assert.throws(() => snapshot(f.primary, f.backup));
  const integrity = new DatabaseSync(f.backup, { readOnly: true });
  try { assert.equal(integrity.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
  finally { integrity.close(); }
});
