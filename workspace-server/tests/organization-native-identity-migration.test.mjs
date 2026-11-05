import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';

const PASSWORD='only-local-synthetic-test-password';
function fixture(t){
 const directory=mkdtempSync(path.join(os.tmpdir(),'duckbio-tenant-native-links-'));
 const databasePath=path.join(directory,'private','identity.sqlite');
 let authorized=true,nativeVerified=true,afterNative=null;
 const actorId=randomUUID(),stamp=1800000000000;
 const config={
  databasePath,clock:()=>stamp,
  orgNativeLinks:{
   authorizeMutation:async x=>authorized&&x.actorId===actorId&&
     ['org-alpha','org-beta'].includes(x.workspaceOrganizationId)&&
     ['goflo','eel'].includes(x.appId),
   verifyNativeOwnership:async x=>{
    if(afterNative)await afterNative(x);
    return nativeVerified;
   }
  }
 };
 const store=createIdentityStore(config);
 t.after(()=>{store.close();rmSync(directory,{force:true,recursive:true})});
 const input=(userId,workspaceOrganizationId='org-alpha',
   nativeUserId='native-user-alpha',nativeOrganizationId='native-org-alpha')=>({
  actorId,userId,appId:'goflo',workspaceOrganizationId,
  nativeUserId,nativeOrganizationId
 });
 return {store,config,databasePath,actorId,input,
  changeAuthorization:x=>{authorized=x},
  changeNativeVerification:x=>{nativeVerified=x},
  duringNative:x=>{afterNative=x},
  snapshot:()=>{const db=new DatabaseSync(databasePath,{readOnly:true});
   try{return {
    links:db.prepare('SELECT * FROM suite_identity_org_native_links').all(),
    audit:db.prepare('SELECT * FROM suite_identity_org_native_audit ORDER BY id').all()
   }}finally{db.close()}
  }
 };
}
async function user(store,n){return store.createUser({email:'org-user-'+n+'@example.test',
 displayName:'Test '+n,password:PASSWORD});}

test('opt-in schema requires private trusted mutation and native ownership verifiers',async t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'duckbio-optin-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const databasePath=path.join(directory,'db.sqlite');
 assert.throws(()=>createIdentityStore({databasePath,orgNativeLinks:{}}),/Trusted organization/);
 const legacy=createIdentityStore({databasePath});
 t.after(()=>legacy.close());
 assert.equal(legacy.getOrganizationNativeLink({userId:randomUUID(),
  appId:'goflo',workspaceOrganizationId:'org-alpha'}),null);
 await assert.rejects(legacy.bindVerifiedOrganizationNativeLink({}),/org_native_links_disabled/);
 await assert.rejects(legacy.migrateVerifiedLegacyNativeLink({}),/org_native_links_disabled/);
});

test('first opt-in open preserves legacy user, session and grant without auto-promoting them',async t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'duckbio-legacy-schema-'));
 t.after(()=>rmSync(directory,{force:true,recursive:true}));
 const dbPath=path.join(directory,'identity.sqlite');
 const legacy=createIdentityStore({databasePath:dbPath});
 const account=await user(legacy,1);
 const login=legacy.createSession(account.id);
 legacy.grantAppAccess({userId:account.id,appId:'goflo',
  localUserId:'old-native-actor',organizationId:'native-org-alpha'});
 legacy.close();
 const verified=createIdentityStore({databasePath:dbPath,orgNativeLinks:{
  authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true
 }});
 t.after(()=>verified.close());
 assert.equal(verified.getParentSession(login.parent.id).subject,account.id);
 assert.equal(verified.getAccess(account.id,'goflo').localIdentity.userId,'old-native-actor');
 assert.equal(verified.getOrganizationNativeLink({userId:account.id,
  appId:'goflo',workspaceOrganizationId:'org-alpha'}),null);
 const portable=verified.exportPortable({includePasswordHashes:true});
 assert.equal(portable.version,1);
 assert.equal(portable.grants.length,1);
});

test('same central user has distinct verified native identities in two Workspace organizations',async t=>{
 const f=fixture(t),account=await user(f.store,2);
 const first=await f.store.bindVerifiedOrganizationNativeLink(f.input(account.id));
 const second=await f.store.bindVerifiedOrganizationNativeLink(
  f.input(account.id,'org-beta','native-user-beta','native-org-beta'));
 assert.equal(first.applied,true);
 assert.equal(second.applied,true);
 assert.equal(first.link.accessGranted,false);
 assert.equal(first.link.licensesGranted,false);
 assert.equal(first.link.loginEnabled,false);
 assert.equal(f.store.getOrganizationNativeLink({userId:account.id,
  appId:'goflo',workspaceOrganizationId:'org-beta'}).nativeUserId,'native-user-beta');
 assert.equal(f.store.getOrganizationNativeLink({userId:account.id,
  appId:'goflo',workspaceOrganizationId:'org-alpha'}).nativeUserId,'native-user-alpha');
 assert.equal(f.store.getAccess(account.id,'goflo'),null,
  'new org mappings must not silently enable the legacy SSO broker');
 assert.equal(f.snapshot().audit.length,2);
});

test('migration of a legacy grant needs explicit native organization and external verification',async t=>{
 const f=fixture(t),account=await user(f.store,3);
 f.store.grantAppAccess({userId:account.id,appId:'goflo',
  localUserId:'native-old',organizationId:'native-old-org'});
 await assert.rejects(f.store.migrateVerifiedLegacyNativeLink({
  actorId:f.actorId,userId:account.id,appId:'goflo',
  workspaceOrganizationId:'org-alpha',nativeOrganizationId:'wrong-native-org'
 }),/legacy_native_link_mismatch/);
 assert.equal(f.snapshot().links.length,0);
 f.changeNativeVerification(false);
 await assert.rejects(f.store.migrateVerifiedLegacyNativeLink({
  actorId:f.actorId,userId:account.id,appId:'goflo',
  workspaceOrganizationId:'org-alpha',nativeOrganizationId:'native-old-org'
 }),/native_ownership_unverified/);
 f.changeNativeVerification(true);
 const migrated=await f.store.migrateVerifiedLegacyNativeLink({
  actorId:f.actorId,userId:account.id,appId:'goflo',
  workspaceOrganizationId:'org-alpha',nativeOrganizationId:'native-old-org'
 });
 assert.equal(migrated.applied,true);
 assert.equal(migrated.link.nativeUserId,'native-old');
 assert.equal(f.store.getAccess(account.id,'goflo').localIdentity.userId,'native-old');
 assert.equal(f.snapshot().audit[0].action,'link.migrated');
});

test('legacy grants lacking native org cannot be guessed without independent evidence',async t=>{
 const f=fixture(t),account=await user(f.store,4);
 f.store.grantAppAccess({userId:account.id,appId:'goflo',localUserId:'legacy-no-org'});
 await assert.rejects(f.store.migrateVerifiedLegacyNativeLink({
  actorId:f.actorId,userId:account.id,appId:'goflo',
  workspaceOrganizationId:'org-alpha'
 }),/invalid_org_native_link/);
 f.changeNativeVerification(false);
 await assert.rejects(f.store.migrateVerifiedLegacyNativeLink({
  actorId:f.actorId,userId:account.id,appId:'goflo',
  workspaceOrganizationId:'org-alpha',nativeOrganizationId:'native-org-from-guess'
 }),/native_ownership_unverified/);
 assert.equal(f.snapshot().links.length,0);
});

test('native user collisions and cross-org tenant remapping deny atomically',async t=>{
 const f=fixture(t),a=await user(f.store,5),b=await user(f.store,6);
 await f.store.bindVerifiedOrganizationNativeLink(f.input(a.id));
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(
  f.input(b.id,'org-beta','native-user-alpha','native-org-beta')
 ),/org_native_link_conflict/);
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(
  f.input(b.id,'org-beta','native-user-beta','native-org-alpha')
 ),/org_native_link_conflict/);
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(
  f.input(b.id,'org-alpha','native-user-beta','native-org-beta')
 ),/org_native_link_conflict/);
 assert.equal(f.snapshot().links.length,1);
 assert.equal(f.snapshot().audit.length,1);
});

test('legacy native identity of another central user cannot be borrowed',async t=>{
 const f=fixture(t),a=await user(f.store,7),b=await user(f.store,8);
 f.store.grantAppAccess({userId:a.id,appId:'goflo',localUserId:'native-borrowed'});
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(
  f.input(b.id,'org-alpha','native-borrowed','native-org-alpha')
 ),/mapping_already_linked/);
 assert.equal(f.snapshot().links.length,0);
});

test('bind is idempotent; changed mapping requires explicit audited revoke',async t=>{
 const f=fixture(t),account=await user(f.store,9);
 const input=f.input(account.id);
 assert.equal((await f.store.bindVerifiedOrganizationNativeLink(input)).applied,true);
 assert.equal((await f.store.bindVerifiedOrganizationNativeLink(input)).applied,false);
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(
  f.input(account.id,'org-alpha','different-user','native-org-alpha')
 ),/org_native_link_conflict/);
 assert.equal((await f.store.revokeVerifiedOrganizationNativeLink({
  actorId:f.actorId,userId:account.id,appId:'goflo',workspaceOrganizationId:'org-alpha'
 })).applied,true);
 assert.equal(f.store.getOrganizationNativeLink({userId:account.id,
  appId:'goflo',workspaceOrganizationId:'org-alpha'}),null);
 assert.equal((await f.store.revokeVerifiedOrganizationNativeLink({
  actorId:f.actorId,userId:account.id,appId:'goflo',workspaceOrganizationId:'org-alpha'
 })).applied,false);
 assert.equal((await f.store.bindVerifiedOrganizationNativeLink(
  f.input(account.id,'org-alpha','different-user','native-org-alpha')
 )).applied,true);
 assert.deepEqual(f.snapshot().audit.map(x=>x.action),
  ['link.bound','link.revoked','link.bound']);
});

test('authorization failure and provider outage leave no mappings and no audit',async t=>{
 const f=fixture(t),account=await user(f.store,10),input=f.input(account.id);
 f.changeAuthorization(false);
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(input),/org_native_link_not_authorized/);
 f.changeAuthorization(true);
 f.duringNative(()=>{throw Error('native-unavailable')});
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(input),/native-unavailable/);
 f.duringNative(null);
 f.changeNativeVerification(false);
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(input),/native_ownership_unverified/);
 assert.equal(f.snapshot().links.length,0);
 assert.equal(f.snapshot().audit.length,0);
});

test('mutation is denied if actor authority disappears during native verification',async t=>{
 const f=fixture(t),account=await user(f.store,11);
 f.duringNative(()=>f.changeAuthorization(false));
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(f.input(account.id)),
  /org_native_link_not_authorized/);
 assert.equal(f.snapshot().links.length,0);
});

test('disabled account hides mapping and blocks further verified writes',async t=>{
 const f=fixture(t),account=await user(f.store,12);
 await f.store.bindVerifiedOrganizationNativeLink(f.input(account.id));
 f.store.setUserState(account.id,'disabled');
 assert.equal(f.store.getOrganizationNativeLink({userId:account.id,
  appId:'goflo',workspaceOrganizationId:'org-alpha'}),null);
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink(
  f.input(account.id,'org-beta','native-user-beta','native-org-beta')
 ),/access_denied/);
 assert.equal(f.snapshot().links.length,1,'historical mapping retained for audit');
});

test('native mapping cannot be silently omitted from portable v1 backup',async t=>{
 const f=fixture(t),account=await user(f.store,13);
 assert.equal(f.store.exportPortable({includePasswordHashes:true}).version,1);
 await f.store.bindVerifiedOrganizationNativeLink(f.input(account.id));
 assert.throws(()=>f.store.exportPortable({includePasswordHashes:true}),
  /org_native_links_require_database_backup/);
 assert.throws(()=>f.store.exportPortable(),/org_native_links_require_database_backup/);
 assert.equal(f.snapshot().links.length,1);
});

test('DataDuck remains outside six-app identity registry and no SSO is activated',async t=>{
 const f=fixture(t),account=await user(f.store,14);
 await assert.rejects(f.store.bindVerifiedOrganizationNativeLink({
  ...f.input(account.id),appId:'dataduck'
 }),/invalid_org_native_link/);
 assert.equal(f.store.getOrganizationNativeLink({userId:account.id,
  appId:'dataduck',workspaceOrganizationId:'org-alpha'}),null);
 assert.equal(f.snapshot().links.length,0);
});

test('stale migration after concurrent legacy mapping change cannot commit',async t=>{
 const f=fixture(t),account=await user(f.store,15);
 f.store.grantAppAccess({userId:account.id,appId:'goflo',
  localUserId:'original-native',organizationId:'native-org-alpha'});
 f.duringNative(()=>{
   f.store.grantAppAccess({userId:account.id,appId:'goflo',
     localUserId:'changed-native',organizationId:'native-org-alpha'});
 });
 await assert.rejects(f.store.migrateVerifiedLegacyNativeLink({
  actorId:f.actorId,userId:account.id,appId:'goflo',
  workspaceOrganizationId:'org-alpha',nativeOrganizationId:'native-org-alpha'
 }),/legacy_native_link_mismatch/);
 assert.equal(f.snapshot().links.length,0);
});
