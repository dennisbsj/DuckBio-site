import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';

test('portable v1 cannot silently lose audit evidence after the last scoped native link was revoked',async t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-audit-backup-'));
 t.after(()=>rmSync(root,{force:true,recursive:true}));
 const dbPath=path.join(root,'private','identity.sqlite');
 const options={databasePath:dbPath,orgNativeLinks:{
  authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true
 }};
 const source=createIdentityStore(options);
 t.after(()=>source.close());
 const account=await source.createUser({
  email:'audit-only@example.test',displayName:'Synthetic',
  password:'private-only-synthetic-passphrase'
 });
 const v1=source.exportPortable({includePasswordHashes:true});
 assert.equal(v1.users.length,1);
 const input={actorId:randomUUID(),userId:account.id,appId:'goflo',
  workspaceOrganizationId:'lab-123',nativeUserId:'native-a',
  nativeOrganizationId:'native-lab-a'};
 const linked=await source.bindVerifiedOrganizationNativeLink(input);
 assert.equal(linked.applied,true);
 assert.throws(()=>source.exportPortable({includePasswordHashes:true}),
  /org_native_links_require_database_backup/);
 const revoked=await source.revokeVerifiedOrganizationNativeLink(input);
 assert.equal(revoked.applied,true);
 assert.equal(source.getOrganizationNativeLink({userId:account.id,
  appId:'goflo',workspaceOrganizationId:'lab-123'}),null);
 assert.equal(source.orgNativeLinkAudit({
  appId:'goflo',workspaceOrganizationId:'lab-123'}).length,2);
 // All links are gone, but the org-native provenance is still durable
 // and cannot be represented by historical portable v1.
 assert.throws(()=>source.exportPortable({includePasswordHashes:true}),
  /org_native_links_require_database_backup/);
 source.close();
 // Even reopening without opt-in must not allow legacy export to drop the
 // existing org-native audit history. The new code inspects existing schema.
 const oldCaller=createIdentityStore({databasePath:dbPath});
 assert.throws(()=>oldCaller.exportPortable({includePasswordHashes:true}),
  /org_native_links_require_database_backup/);
 oldCaller.close();
 // Simulate a cleanup that has removed all users, leaving only audit rows.
 // A v1 import still may not mix a new identity history into this DB.
 const sqlite=new DatabaseSync(dbPath);
 sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.prepare('DELETE FROM suite_identity_users WHERE id=?').run(account.id);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM suite_identity_users').get().n,0);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM suite_identity_org_native_links').get().n,0);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM suite_identity_org_native_audit').get().n,2);
 sqlite.close();
 const reopened=createIdentityStore({databasePath:dbPath});
 assert.throws(()=>reopened.importPortable(v1),
  /org_native_links_require_database_backup/);
 assert.equal(reopened.listUsers().length,0);
 reopened.close();
});

test('opt-in but never-used native link schema preserves legacy portable v1 semantics',async t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-empty-backup-'));
 t.after(()=>rmSync(root,{force:true,recursive:true}));
 const store=createIdentityStore({
  databasePath:path.join(root,'identity.sqlite'),
  orgNativeLinks:{authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true}
 });
 t.after(()=>store.close());
 const account=await store.createUser({email:'empty@example.test',
  displayName:'Empty',password:'private-only-synthetic-passphrase'});
 const bundle=store.exportPortable({includePasswordHashes:true});
 assert.equal(bundle.version,1);
 assert.equal(bundle.users[0].id,account.id);
 assert.equal(bundle.grants.length,0);
});
